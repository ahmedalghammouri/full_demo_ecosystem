import { Test, TestingModule } from '@nestjs/testing';
import { ReliabilityService } from './reliability.service';
import { PrismaService } from '../../database/prisma.service';

const mockPrisma = {
  machine: { findMany: jest.fn(), count: jest.fn() },
  machineStateRecord: { aggregate: jest.fn() },
  downtimeEvent: { findMany: jest.fn() },
  maintenanceWO: { findMany: jest.fn(), count: jest.fn() },
};

const HOUR = 3_600_000;
const from = new Date('2026-01-01T00:00:00.000Z');
const to = new Date('2026-01-11T00:00:00.000Z'); // 240 h window, fully in the past

describe('ReliabilityService', () => {
  let service: ReliabilityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReliabilityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ReliabilityService);
  });

  // ─── Failure classification ───────────────────────────────

  describe('isFailureStop', () => {
    it('counts an unplanned breakdown as a failure', () => {
      expect(service.isFailureStop({
        isPlanned: false, category: 'MECHANICAL', reasonCode: 'UNPLANNED_BREAKDOWN',
      } as any)).toBe(true);
    });

    it('counts a mechanical/electrical stop as a failure even under a generic reason code', () => {
      expect(service.isFailureStop({ isPlanned: false, category: 'ELECTRICAL' } as any)).toBe(true);
    });

    it('excludes micro-stops, starved and blocked — flow losses, not asset failures', () => {
      for (const reasonCode of ['MICRO_STOP', 'STARVED', 'BLOCKED']) {
        expect(service.isFailureStop({
          isPlanned: false, category: 'MECHANICAL', reasonCode,
        } as any)).toBe(false);
      }
    });

    it('excludes material, operator and quality stops', () => {
      for (const category of ['MATERIAL', 'OPERATOR', 'QUALITY']) {
        expect(service.isFailureStop({ isPlanned: false, category } as any)).toBe(false);
      }
    });

    it('excludes planned work — by flag or by category (incl. PLANNED_CLEANING)', () => {
      expect(service.isFailureStop({ isPlanned: true, category: 'MECHANICAL' } as any)).toBe(false);
      expect(service.isFailureStop({ isPlanned: false, category: 'PLANNED_CLEANING' } as any)).toBe(false);
      expect(service.isFailureStop({ isPlanned: false, category: 'CHANGEOVER' } as any)).toBe(false);
    });
  });

  // ─── Equipment lens ───────────────────────────────────────

  describe('equipmentReliability', () => {
    it('derives MTTR/MTBF from breakdown stops only, over capacity minus all downtime', async () => {
      mockPrisma.machine.count.mockResolvedValue(2); // capacity = 240 h × 2 = 480 h
      mockPrisma.downtimeEvent.findMany.mockResolvedValue([
        // 2 breakdowns, 2 h each → 4 h of failure downtime
        { startTime: new Date(from.getTime() + HOUR), endTime: new Date(from.getTime() + 3 * HOUR), category: 'MECHANICAL', reasonCode: 'UNPLANNED_BREAKDOWN', isPlanned: false, durationMinutes: 120 },
        { startTime: new Date(from.getTime() + 10 * HOUR), endTime: new Date(from.getTime() + 12 * HOUR), category: 'ELECTRICAL', reasonCode: 'UNPLANNED_BREAKDOWN', isPlanned: false, durationMinutes: 120 },
        // 1 h material stop — unplanned, but not a failure
        { startTime: new Date(from.getTime() + 20 * HOUR), endTime: new Date(from.getTime() + 21 * HOUR), category: 'MATERIAL', reasonCode: 'STARVED', isPlanned: false, durationMinutes: 60 },
        // 1 h planned changeover
        { startTime: new Date(from.getTime() + 30 * HOUR), endTime: new Date(from.getTime() + 31 * HOUR), category: 'CHANGEOVER', reasonCode: 'CHANGEOVER', isPlanned: true, durationMinutes: 60 },
      ]);

      const r = await service.equipmentReliability('f-1', undefined, from, to);

      expect(r.failures).toBe(2);
      expect(r.unplannedStops).toBe(3);
      expect(r.failureDowntimeHours).toBe(4);
      expect(r.plannedDowntimeHours).toBe(1);
      expect(r.totalDowntimeHours).toBe(6);
      expect(r.capacityHours).toBe(480);
      expect(r.uptimeHours).toBe(474); // 480 − 6
      expect(r.mttrHours).toBe(2); // 4 h ÷ 2 breakdowns
      expect(r.mtbfHours).toBe(237); // 474 h ÷ 2 breakdowns
    });

    it('clamps stops that overlap the window edges', async () => {
      mockPrisma.machine.count.mockResolvedValue(1);
      mockPrisma.downtimeEvent.findMany.mockResolvedValue([
        // Starts 5 h before the window, ends 3 h into it → only 3 h counts
        { startTime: new Date(from.getTime() - 5 * HOUR), endTime: new Date(from.getTime() + 3 * HOUR), category: 'MECHANICAL', reasonCode: 'UNPLANNED_BREAKDOWN', isPlanned: false, durationMinutes: 480 },
      ]);

      const r = await service.equipmentReliability('f-1', undefined, from, to);
      expect(r.failures).toBe(1);
      expect(r.failureDowntimeHours).toBe(3);
    });

    it('returns uptime as MTBF and zero MTTR when there are no breakdowns', async () => {
      mockPrisma.machine.count.mockResolvedValue(1);
      mockPrisma.downtimeEvent.findMany.mockResolvedValue([]);

      const r = await service.equipmentReliability('f-1', undefined, from, to);
      expect(r.failures).toBe(0);
      expect(r.mttrHours).toBe(0);
      expect(r.mtbfHours).toBe(240);
    });
  });

  // ─── Maintenance lens ─────────────────────────────────────

  describe('maintenanceReliability', () => {
    it('uses RUNNING machine-state hours as the MTBF denominator when available', async () => {
      mockPrisma.maintenanceWO.findMany.mockResolvedValue([
        { actualHours: 3, startedAt: null, completedAt: null },
        { actualHours: 1, startedAt: null, completedAt: null },
      ]);
      mockPrisma.maintenanceWO.count.mockResolvedValue(4); // 4 failures raised
      mockPrisma.machine.count.mockResolvedValue(2);
      mockPrisma.machineStateRecord.aggregate.mockResolvedValue({ _sum: { durationMinutes: 24_000 } }); // 400 h

      const r = await service.maintenanceReliability('f-1', undefined, from, to);

      expect(r.operatingHoursSource).toBe('MACHINE_STATE');
      expect(r.operatingHours).toBe(400);
      expect(r.repairs).toBe(2);
      expect(r.mttrHours).toBe(2); // (3 + 1) ÷ 2
      expect(r.mtbfHours).toBe(100); // 400 ÷ 4
    });

    it('falls back to machines × window hours when no state history exists', async () => {
      mockPrisma.maintenanceWO.findMany.mockResolvedValue([]);
      mockPrisma.maintenanceWO.count.mockResolvedValue(2);
      mockPrisma.machine.count.mockResolvedValue(3);
      mockPrisma.machineStateRecord.aggregate.mockResolvedValue({ _sum: { durationMinutes: 0 } });

      const r = await service.maintenanceReliability('f-1', undefined, from, to);

      expect(r.operatingHoursSource).toBe('CALENDAR');
      expect(r.operatingHours).toBe(720); // 3 machines × 240 h
      expect(r.mtbfHours).toBe(360); // 720 ÷ 2
      expect(r.mttrHours).toBe(0); // no completed repairs in the window
    });

    it('falls back to started→completed elapsed time when actual hours are not logged', async () => {
      mockPrisma.maintenanceWO.findMany.mockResolvedValue([
        {
          actualHours: null,
          startedAt: new Date(from.getTime() + HOUR),
          completedAt: new Date(from.getTime() + 6 * HOUR),
        },
      ]);
      mockPrisma.maintenanceWO.count.mockResolvedValue(1);
      mockPrisma.machine.count.mockResolvedValue(1);
      mockPrisma.machineStateRecord.aggregate.mockResolvedValue({ _sum: { durationMinutes: 0 } });

      const r = await service.maintenanceReliability('f-1', undefined, from, to);
      expect(r.repairs).toBe(1);
      expect(r.mttrHours).toBe(5);
    });
  });
});
