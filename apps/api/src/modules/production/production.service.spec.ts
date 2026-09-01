import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductionService } from './production.service';
import { OEEService } from './oee.service';
import { KpiService } from './kpi.service';
import { ApsService } from '../aps/aps.service';
import { HistorianService } from '../historian/historian.service';
import { AutoPlannedStopService } from './auto-planned-stop.service';
import { PrismaService } from '../../database/prisma.service';

const mockPrisma = {
  workOrder: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  sKU: { findFirst: jest.fn() },
  machine: { findFirst: jest.fn() },
  productionOrder: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  machineCycleTime: { findFirst: jest.fn() },
  oEERecord: {
    aggregate: jest.fn().mockResolvedValue({ _avg: { oee: null, availability: null, performance: null, quality: null } }),
    create: jest.fn(),
  },
  downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
  machineCurrentStatus: { upsert: jest.fn() },
  productionEvent: { create: jest.fn() },
  // startWorkOrder dispatches READY job orders → no ready JOs in these unit tests.
  jobOrder: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
};

const mockEventEmitter = { emit: jest.fn() };

// ProductionService also depends on KpiService, ApsService and HistorianService.
// They are not under test here, so provide light mocks to satisfy DI.
const mockKpi = {
  recomputeWorkOrderAndPO: jest.fn().mockResolvedValue(undefined),
  recomputeProductionOrder: jest.fn().mockResolvedValue(undefined),
  propagateFromJobOrder: jest.fn().mockResolvedValue(undefined),
  oeeAnalytics: jest.fn().mockResolvedValue({
    current: { oee: 0, availability: 0, performance: 0, quality: 0, oeeTb: 0, availabilityTb: 0 },
    totalOutput: 0, goodOutput: 0, downtimeMin: 0, byEquipment: [], trend: [],
  }),
  resolveScopeMachineIds: jest.fn().mockResolvedValue(undefined),
};
const mockAps = { autoGenerateWorkOrders: jest.fn(), previewAutoGenerateWOs: jest.fn() };
const mockHistorian = { getOeeTrend: jest.fn().mockResolvedValue([]), getProductionTrend: jest.fn().mockResolvedValue([]) };

describe('ProductionService', () => {
  let service: ProductionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        OEEService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: KpiService, useValue: mockKpi },
        { provide: ApsService, useValue: mockAps },
        { provide: HistorianService, useValue: mockHistorian },
        // Books an order's own planned stops on the transition into
        // execution. Stubbed to zero here: these tests are about the
        // transition itself, and a real one would need a stop plan.
        { provide: AutoPlannedStopService, useValue: { onJobOrderStart: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
  });

  // ─── State Machine ────────────────────────────────────────

  describe('startWorkOrder', () => {
    it('transitions PLANNED → IN_PROGRESS', async () => {
      // WOs have no header machine — machine state is driven per job order.
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', orderNumber: 'WO-2026060600-0001', status: 'PLANNED',
        skuId: 'sku-1', factoryId: 'f-1', plannedQty: 3000,
      });
      mockPrisma.workOrder.update.mockResolvedValueOnce({
        id: 'wo-1', orderNumber: 'WO-2026060600-0001', status: 'IN_PROGRESS',
        skuId: 'sku-1', factoryId: 'f-1',
        sku: { name: 'Powder Filler 2L', code: 'BB2L' },
      });
      mockPrisma.productionEvent.create.mockResolvedValueOnce({});

      const result = await service.startWorkOrder('f-1', 'user-1', 'wo-1');
      expect(result.status).toBe('IN_PROGRESS');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'production.work-order.started',
        expect.objectContaining({ factoryId: 'f-1' }),
      );
    });

    it('rejects starting a COMPLETED work order', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', status: 'COMPLETED', factoryId: 'f-1',
      });

      await expect(service.startWorkOrder('f-1', 'user-1', 'wo-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for unknown WO', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce(null);
      await expect(service.startWorkOrder('f-1', 'user-1', 'unknown'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('holdWorkOrder', () => {
    it('transitions IN_PROGRESS → ON_HOLD', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', status: 'IN_PROGRESS', factoryId: 'f-1',
        skuId: 'sku-1', orderNumber: 'WO-001',
      });
      mockPrisma.workOrder.update.mockResolvedValueOnce({ id: 'wo-1', status: 'ON_HOLD' });
      mockPrisma.productionEvent.create.mockResolvedValueOnce({});

      const result = await service.holdWorkOrder('f-1', 'user-1', 'wo-1', {
        reason: 'Waiting for material',
      });
      expect(result.status).toBe('ON_HOLD');
    });

    it('rejects holding a PLANNED work order', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', status: 'PLANNED', factoryId: 'f-1',
      });
      await expect(service.holdWorkOrder('f-1', 'user-1', 'wo-1', { reason: 'test' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelWorkOrder', () => {
    it('cancels an IN_PROGRESS work order', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', status: 'IN_PROGRESS', factoryId: 'f-1',
        orderNumber: 'WO-001',
      });
      mockPrisma.workOrder.update.mockResolvedValueOnce({ id: 'wo-1', status: 'CANCELLED' });
      mockPrisma.productionEvent.create.mockResolvedValueOnce({});

      const result = await service.cancelWorkOrder('f-1', 'user-1', 'wo-1', 'SKU change');
      expect(result.status).toBe('CANCELLED');
    });

    it('cannot cancel a COMPLETED work order', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', status: 'COMPLETED', factoryId: 'f-1',
      });
      await expect(service.cancelWorkOrder('f-1', 'user-1', 'wo-1', 'reason'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── Count Recording ──────────────────────────────────────

  describe('recordCount', () => {
    it('increments actualQty and goodQty', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1', status: 'IN_PROGRESS', factoryId: 'f-1',
        goodQty: 200, reworkQty: 5, plannedQty: 3000, skuId: 'sku-1',
      });
      mockPrisma.workOrder.update.mockResolvedValueOnce({
        id: 'wo-1', actualQty: 350, goodQty: 350, reworkQty: 5,
      });
      mockPrisma.productionEvent.create.mockResolvedValueOnce({});

      const result = await service.recordCount('f-1', 'wo-1', { goodCount: 150, rejectCount: 0 });
      expect(result.actualQty).toBe(350);
      expect(result.goodQty).toBe(350);
    });

    it('rejects count update for non-IN_PROGRESS WO', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValueOnce(null);
      await expect(service.recordCount('f-1', 'wo-1', { goodCount: 10 }))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── KPIs ─────────────────────────────────────────────────

  // ─── Quantity units ───────────────────────────────────────
  /**
   * A work order's commitment and its produced quantities must be comparable.
   *
   * `WorkOrder.plannedQty` is counted in `WorkOrder.qtyUnit` — PALLET on a packaging
   * line — while every produced quantity the API reports is converted to PIECES.
   * Returning the raw 150 next to a pieces figure made the work-order screen label
   * "150 PALLET" as "150 INNER" and made the progress bar divide pieces by pallets:
   * 160 pieces to a pallet on this SKU, so a bar read 160× high, and the production
   * order beside it — which did convert — disagreed with it on the same screen.
   */
  describe('work-order quantity units', () => {
    // GENTO 4X2.25 Kg C: 1 piece per inner, 4 inners per carton, 40 cartons per
    // pallet → 160 pieces to a pallet.
    const sku = { name: 'GENTO', code: '10310189', baseUnit: 'CARTON', unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40 };

    const wo = (over: Record<string, unknown> = {}) => ({
      id: 'wo1', orderNumber: 'WO-2026-0001', status: 'IN_PROGRESS',
      plannedQty: 150, qtyUnit: 'PALLET',
      actualQty: 0, goodQty: 0, scrapQty: 0, reworkQty: 0,
      sku, jobOrders: [], downtimeEvents: [], batchRecords: [], machines: [],
      ...over,
    });

    it('converts the commitment to PIECES so it can be compared with output', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValue(wo());
      const r: any = await service.getWorkOrderById('f1', 'wo1');

      expect(r.plannedQtyBase).toBe(150 * 160);   // 24,000 pieces
    });

    it('keeps the commitment as ORDERED, in the unit it was ordered in', async () => {
      // "150 PALLET" is what the planner typed and what the operator recognises —
      // a screen that can only show pieces has lost that.
      mockPrisma.workOrder.findFirst.mockResolvedValue(wo());
      const r: any = await service.getWorkOrderById('f1', 'wo1');

      expect(r.plannedQtyOrdered).toBe(150);
      expect(r.plannedQtyOrderedUnit).toBe('PALLET');
    });

    it('does not label the commitment with the derived display unit', async () => {
      // qtyUnit is the unit of the PIECES figures (INNER here, since an inner holds
      // one piece). It must not be read as the unit of plannedQtyOrdered.
      mockPrisma.workOrder.findFirst.mockResolvedValue(wo());
      const r: any = await service.getWorkOrderById('f1', 'wo1');

      expect(r.qtyUnit).not.toBe(r.plannedQtyOrderedUnit);
    });

    it('leaves a commitment already counted in pieces untouched', async () => {
      mockPrisma.workOrder.findFirst.mockResolvedValue(wo({ plannedQty: 400_000, qtyUnit: 'PIECE' }));
      const r: any = await service.getWorkOrderById('f1', 'wo1');

      expect(r.plannedQtyBase).toBe(400_000);
    });
  });

  describe('getKPIs', () => {
    it('returns KPI object sourced from the OEE engine, incl. both OEE variants', async () => {
      // getKPIs sources OEE from KpiService.oeeAnalytics (the single source of truth),
      // exposing schedule-based AND time-based (OEE-TB) values.
      mockKpi.oeeAnalytics.mockResolvedValueOnce({
        current: { oee: 82.5, availability: 87.2, performance: 94.8, quality: 99.2, oeeTb: 80.1, availabilityTb: 84.6 },
        totalOutput: 0, goodOutput: 0, downtimeMin: 0, byEquipment: [], trend: [],
      });
      mockPrisma.workOrder.count.mockResolvedValue(50);

      const kpis = await service.getKPIs('f-1');
      expect(kpis).toHaveProperty('oee', 82.5);
      expect(kpis).toHaveProperty('availability', 87.2);
      expect(kpis).toHaveProperty('oeeTb', 80.1);
      expect(kpis).toHaveProperty('availabilityTb', 84.6);
      expect(kpis).toHaveProperty('totalOrders');
      expect(kpis).toHaveProperty('inProgressOrders');
      expect(kpis).toHaveProperty('completedOrders');
    });
  });
});
