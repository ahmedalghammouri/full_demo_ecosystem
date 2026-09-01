import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MaintenanceService } from './maintenance.service';
import { TraceabilityService } from '../traceability/traceability.service';
import { ReliabilityService } from '../reliability/reliability.service';
import { PrismaService } from '../../database/prisma.service';

const mockPrisma = {
  maintenanceWO: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  machine: { findFirst: jest.fn() },
  user: { findUnique: jest.fn() },
  sparePart: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  maintWOSparePart: {
    create: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
  },
  machineCurrentStatus: { upsert: jest.fn() },
  workOrder: { findFirst: jest.fn() },
  pMPlan: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  pMTask: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
};

const mockEventEmitter = { emit: jest.fn() };
// MaintenanceService logs lifecycle events to the traceability ledger (fire-and-forget).
const mockTraceability = { logEvent: jest.fn().mockResolvedValue(undefined) };
// Reliability (MTTR/MTBF) lives in the shared ReliabilityService — stubbed here.
const mockReliability = {
  scopeMachineIds: jest.fn().mockResolvedValue(undefined),
  maintenanceReliability: jest.fn().mockResolvedValue({
    failures: 0, repairs: 0, repairHours: 0, operatingHours: 0,
    operatingHoursSource: 'CALENDAR', mttrHours: 0, mtbfHours: 0,
    machineCount: 0, windowHours: 0,
  }),
};

describe('MaintenanceService', () => {
  let service: MaintenanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: TraceabilityService, useValue: mockTraceability },
        // MTTR/MTBF are delegated to the canonical reliability engine.
        { provide: ReliabilityService, useValue: mockReliability },
      ],
    }).compile();
    service = module.get<MaintenanceService>(MaintenanceService);
  });

  // ─── State Machine ────────────────────────────────────────

  describe('assignWO', () => {
    it('assigns technician and transitions to ASSIGNED', async () => {
      mockPrisma.maintenanceWO.findFirst.mockResolvedValueOnce({
        id: 'mwo-1', status: 'OPEN', factoryId: 'f-1', woNumber: 'MWO-001',
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'tech-1', name: 'Ahmed Tech' });
      mockPrisma.maintenanceWO.update.mockResolvedValueOnce({
        id: 'mwo-1', status: 'ASSIGNED', assignedToId: 'tech-1',
        assignedTo: { name: 'Ahmed Tech', email: 'a@t.com' },
      });

      const result = await service.assignWO('f-1', 'mwo-1', { assignedToId: 'tech-1' });
      expect(result.status).toBe('ASSIGNED');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('maintenance.wo.assigned', expect.anything());
    });

    it('rejects assigning a COMPLETED work order', async () => {
      mockPrisma.maintenanceWO.findFirst.mockResolvedValueOnce({
        id: 'mwo-1', status: 'COMPLETED', factoryId: 'f-1',
      });
      await expect(service.assignWO('f-1', 'mwo-1', { assignedToId: 'tech-1' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('completeWO', () => {
    it('completes a WO and deducts spare parts stock', async () => {
      mockPrisma.maintenanceWO.findFirst.mockResolvedValueOnce({
        id: 'mwo-1', status: 'IN_PROGRESS', factoryId: 'f-1', machineId: 'm-1',
        woNumber: 'MWO-001',
      });
      mockPrisma.sparePart.findFirst.mockResolvedValueOnce({
        id: 'sp-1', partNumber: 'BLT-001', name: 'Conveyor Belt', stockQty: 5, unitCost: 500,
      });
      mockPrisma.maintWOSparePart.create.mockResolvedValueOnce({});
      mockPrisma.sparePart.update.mockResolvedValueOnce({ stockQty: 4 });
      mockPrisma.maintenanceWO.update.mockResolvedValueOnce({
        id: 'mwo-1', status: 'COMPLETED', actualHours: 3.5,
        laborCost: 300, partsCost: 500, totalCost: 800,
      });
      mockPrisma.machineCurrentStatus.upsert.mockResolvedValueOnce({});

      const result = await service.completeWO('f-1', 'mwo-1', {
        actualHours: 3.5,
        laborCost: 300,
        partsCost: 500,
        sparesUsed: [{ sparePartId: 'sp-1', quantity: 1 }],
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.totalCost).toBe(800);
      expect(mockPrisma.sparePart.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { stockQty: { decrement: 1 } },
      }));
    });

    it('rejects completion when spare part stock is insufficient', async () => {
      mockPrisma.maintenanceWO.findFirst.mockResolvedValueOnce({
        id: 'mwo-1', status: 'IN_PROGRESS', factoryId: 'f-1', machineId: 'm-1',
      });
      mockPrisma.sparePart.findFirst.mockResolvedValueOnce({
        id: 'sp-1', partNumber: 'BLT-001', stockQty: 0, unitCost: 500,
      });

      await expect(service.completeWO('f-1', 'mwo-1', {
        actualHours: 2,
        sparesUsed: [{ sparePartId: 'sp-1', quantity: 2 }],
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('startWO', () => {
    it('sets machine to MAINTENANCE state', async () => {
      mockPrisma.maintenanceWO.findFirst.mockResolvedValueOnce({
        id: 'mwo-1', status: 'ASSIGNED', factoryId: 'f-1', machineId: 'm-1',
      });
      mockPrisma.maintenanceWO.update.mockResolvedValueOnce({
        id: 'mwo-1', status: 'IN_PROGRESS', startedAt: new Date(),
      });
      mockPrisma.machineCurrentStatus.upsert.mockResolvedValueOnce({});

      await service.startWO('f-1', 'mwo-1', {});
      expect(mockPrisma.machineCurrentStatus.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ state: 'MAINTENANCE' }),
      }));
    });
  });

  describe('cancelWO', () => {
    it('cannot cancel a COMPLETED work order', async () => {
      mockPrisma.maintenanceWO.findFirst.mockResolvedValueOnce({
        id: 'mwo-1', status: 'COMPLETED', factoryId: 'f-1',
      });
      await expect(service.cancelWO('f-1', 'mwo-1', 'user-1', { reason: 'test' }))
        .rejects.toThrow(BadRequestException);
    });
  });
});
