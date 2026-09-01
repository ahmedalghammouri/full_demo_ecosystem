import { OEEService } from './oee.service';

describe('OEEService', () => {
  let service: OEEService;

  beforeEach(() => {
    service = new OEEService();
  });

  describe('calculate', () => {
    it('should calculate OEE correctly for world-class performance', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 30,
        idealCycleTime: 1,
        totalCount: 400,
        goodCount: 392,
      });

      expect(result.availability).toBeCloseTo(93.75, 0);
      expect(result.quality).toBeCloseTo(98.0, 0);
      expect(result.oee).toBeGreaterThan(0);
      expect(result.oee).toBeLessThanOrEqual(100);
    });

    it('should return 0 OEE when no good parts produced', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 80,
        idealCycleTime: 1,
        totalCount: 100,
        goodCount: 0,
      });

      expect(result.quality).toBe(0);
      expect(result.oee).toBe(0);
    });

    it('should return 100 OEE for perfect conditions', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 0,
        idealCycleTime: 1,
        totalCount: 480,
        goodCount: 480,
      });

      expect(result.availability).toBeCloseTo(100);
      expect(result.performance).toBeCloseTo(100);
      expect(result.quality).toBeCloseTo(100);
      expect(result.oee).toBeCloseTo(100);
    });

    it('should cap values at 100 when performance exceeds theoretical', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 0,
        idealCycleTime: 1,
        totalCount: 600,
        goodCount: 600,
      });

      expect(result.availability).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateDetailed (six-loss)', () => {
    it('excludes planned stops from PPT and counts unplanned as availability loss', () => {
      // PPT already net of planned stops = 660 min; 60 min unplanned breakdown
      const r = service.calculateDetailed({
        plannedProductionTime: 660,
        unplannedDowntime: 60,
        idealCycleTime: 0.2, // min/unit
        totalCount: 2700,
        goodCount: 2670,
      });
      expect(r.runTime).toBe(600);
      expect(r.availability).toBeCloseTo(90.9, 0); // 600/660
      expect(r.performance).toBeCloseTo(90.0, 0);  // (0.2*2700)/600 = 540/600
      expect(r.quality).toBeCloseTo(98.9, 0);      // 2670/2700
      expect(r.oee).toBeGreaterThan(0);
      expect(r.oee).toBeLessThanOrEqual(100);
    });

    it('caps performance at 100 and never exceeds bounds', () => {
      const r = service.calculateDetailed({
        plannedProductionTime: 100, unplannedDowntime: 0,
        idealCycleTime: 1, totalCount: 200, goodCount: 200,
      });
      expect(r.performance).toBeLessThanOrEqual(100);
      expect(r.availability).toBe(100);
    });
  });

  describe('availabilityFromSegments', () => {
    it('computes availability from segments, excluding planned stops AND external losses', () => {
      const r = service.availabilityFromSegments([
        { state: 'RUNNING', durationMinutes: 600 },
        { state: 'BREAKDOWN', durationMinutes: 40 },
        { state: 'STARVED', durationMinutes: 20 },
        { state: 'PLANNED_STOP', durationMinutes: 60, isPlannedStop: true }, // excluded from PPT
      ]);
      expect(r.ppt).toBe(640);       // 720 scheduled − 60 planned − 20 external
      expect(r.runTime).toBe(600);
      expect(r.externalLoss).toBe(20);
      expect(r.unplannedDowntime).toBe(40);   // the breakdown only — starved is not the machine's fault
      expect(r.availability).toBeCloseTo(93.75, 1);
    });
  });

  describe('rollup', () => {
    it('rolls up children by summing quantities, not averaging percentages', () => {
      // One big efficient JO + one small bad JO — naive average would mislead.
      const parent = service.rollup([
        { ppt: 600, runTime: 600, idealRunTime: 600, totalCount: 1000, goodCount: 1000 }, // 100%
        { ppt: 60, runTime: 30, idealRunTime: 15, totalCount: 50, goodCount: 25 },          // poor
      ]);
      // availability = 630/660, performance = 615/630, quality = 1025/1050
      expect(parent.availability).toBeCloseTo(95.5, 0);
      expect(parent.performance).toBeCloseTo(97.6, 0);
      expect(parent.quality).toBeCloseTo(97.6, 0);
      expect(parent.oee).toBeCloseTo(91.0, 0);
    });

    it('returns zeros for empty children', () => {
      const parent = service.rollup([]);
      expect(parent.oee).toBe(0);
      expect(parent.availability).toBe(0);
    });
  });

  describe('getClassification', () => {
    it('should classify world-class OEE correctly', () => {
      expect(service.getClassification(85)).toBe('world-class');
      expect(service.getClassification(95)).toBe('world-class');
    });

    it('should classify good OEE correctly', () => {
      expect(service.getClassification(65)).toBe('good');
      expect(service.getClassification(84)).toBe('good');
    });

    it('should classify poor OEE correctly', () => {
      expect(service.getClassification(30)).toBe('poor');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // External losses (STARVED / BLOCKED) — the pilot site PoC items 10–12.
  // A downstream machine waiting on the bottleneck must not be
  // penalised on Availability or Performance.
  // ─────────────────────────────────────────────────────────────

  describe('external loss (starved / blocked)', () => {
    it('removes external loss from PPT so Availability is not penalised', () => {
      // 480 planned, 120 min starved waiting on upstream, 360 min actually running.
      const r = service.calculateDetailed({
        plannedProductionTime: 480,
        externalLoss: 120,
        unplannedDowntime: 0,
        idealCycleTime: 1,
        totalCount: 360,
        goodCount: 360,
      });

      expect(r.ppt).toBe(360);            // 480 − 120 accountable minutes
      expect(r.runTime).toBe(360);
      expect(r.availability).toBe(100);   // was 75% before the fix
      expect(r.performance).toBe(100);    // was 75% before the fix
      expect(r.losses.externalLossMin).toBe(120);
    });

    it('still charges the machine for its own unplanned downtime', () => {
      const r = service.calculateDetailed({
        plannedProductionTime: 480,
        externalLoss: 60,
        unplannedDowntime: 42,   // own breakdown
        idealCycleTime: 1,
        totalCount: 378,
        goodCount: 378,
      });

      expect(r.ppt).toBe(420);
      expect(r.runTime).toBe(378);
      expect(r.availability).toBe(90);   // 378 / 420
      expect(r.losses.availabilityLossMin).toBe(42);
      expect(r.losses.externalLossMin).toBe(60);
    });

    it('classifies STARVED and BLOCKED segments as external, not downtime', () => {
      const r = service.availabilityFromSegments([
        { state: 'RUNNING', durationMinutes: 300 },
        { state: 'STARVED', durationMinutes: 60 },
        { state: 'BLOCKED', durationMinutes: 30 },
        { state: 'BREAKDOWN', durationMinutes: 30 },
        { state: 'PLANNED_STOP', durationMinutes: 60 },
      ]);

      expect(r.plannedDowntime).toBe(60);
      expect(r.externalLoss).toBe(90);      // starved + blocked
      expect(r.ppt).toBe(330);              // 480 − 60 planned − 90 external
      expect(r.runTime).toBe(300);
      expect(r.unplannedDowntime).toBe(30); // only the real breakdown
      expect(r.availability).toBeCloseTo(90.9, 1);
    });

    it('carries external loss through a roll-up instead of losing it', () => {
      const r = service.rollup([
        { ppt: 480, runTime: 360, idealRunTime: 360, externalLoss: 120, totalCount: 360, goodCount: 360 },
        { ppt: 480, runTime: 420, idealRunTime: 420, externalLoss: 60, totalCount: 420, goodCount: 420 },
      ]);

      expect(r.externalLoss).toBe(180);
      expect(r.ppt).toBe(780);          // 960 gross − 180 external
      expect(r.runTime).toBe(780);
      expect(r.availability).toBe(100);
      expect(r.performance).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Bottleneck-based Overall Line OEE — the pilot site PoC items 7–9.
  // ─────────────────────────────────────────────────────────────

  describe('lineOee (bottleneck method)', () => {
    it('uses bottleneck A and P with final-outfeed Q', () => {
      const r = service.lineOee({
        bottleneck: { availability: 90, performance: 95, machineName: 'Powder Filler' },
        finalOutfeed: { totalCount: 10_000, goodCount: 9_800, pointName: 'Wrapping Machine' },
      });

      expect(r.availability).toBe(90);
      expect(r.performance).toBe(95);
      expect(r.quality).toBe(98);
      expect(r.oee).toBeCloseTo(83.8, 1);   // 0.90 × 0.95 × 0.98
      expect(r.basis.method).toBe('BOTTLENECK');
      expect(r.basis.bottleneckMachineName).toBe('Powder Filler');
      expect(r.basis.outfeedPointName).toBe('Wrapping Machine');
    });

    it('is unaffected by a starved downstream machine', () => {
      // The palletizer's own numbers are irrelevant to line OEE — only the
      // constraint and the final outfeed count.
      const r = service.lineOee({
        bottleneck: { availability: 88, performance: 92 },
        finalOutfeed: { totalCount: 5_000, goodCount: 5_000 },
      });
      expect(r.quality).toBe(100);
      expect(r.oee).toBeCloseTo(81, 0);
    });

    it('returns zero quality — and zero OEE — when nothing reached the outfeed', () => {
      const r = service.lineOee({
        bottleneck: { availability: 95, performance: 95 },
        finalOutfeed: { totalCount: 0, goodCount: 0 },
      });
      expect(r.quality).toBe(0);
      expect(r.oee).toBe(0);
    });
  });
});
