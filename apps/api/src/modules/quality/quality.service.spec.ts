import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QualityService } from './quality.service';
import { PrismaService } from '../../database/prisma.service';

const mockPrisma = {
  inspectionResult: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  nCR: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  cAPA: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  cAPAAction: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  workOrder: { findFirst: jest.fn() },
  machine: { findFirst: jest.fn() },
  factory: { findFirst: jest.fn() },
};

const mockEventEmitter = { emit: jest.fn() };

describe('QualityService', () => {
  let service: QualityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();
    service = module.get<QualityService>(QualityService);
  });

  // ─── NCR State Machine ────────────────────────────────────

  describe('updateNCRStatus', () => {
    it('transitions OPEN → IN_REVIEW', async () => {
      mockPrisma.nCR.findFirst.mockResolvedValueOnce({
        id: 'ncr-1', status: 'OPEN', ncrNumber: 'NCR-202606-0001', factoryId: 'f-1',
      });
      mockPrisma.nCR.update.mockResolvedValueOnce({ id: 'ncr-1', status: 'IN_REVIEW' });

      const result = await service.updateNCRStatus('f-1', 'ncr-1', 'user-1', { status: 'IN_REVIEW' as any });
      expect(result.status).toBe('IN_REVIEW');
    });

    it('rejects invalid transition RESOLVED → OPEN', async () => {
      mockPrisma.nCR.findFirst.mockResolvedValueOnce({
        id: 'ncr-1', status: 'RESOLVED', factoryId: 'f-1', ncrNumber: 'NCR-001',
      });

      await expect(service.updateNCRStatus('f-1', 'ncr-1', 'user-1', { status: 'OPEN' as any }))
        .rejects.toThrow(BadRequestException);
    });

    it('sets resolvedAt when transitioning to RESOLVED', async () => {
      mockPrisma.nCR.findFirst.mockResolvedValueOnce({
        id: 'ncr-1', status: 'IN_REVIEW', ncrNumber: 'NCR-001', factoryId: 'f-1',
      });
      mockPrisma.nCR.update.mockResolvedValueOnce({
        id: 'ncr-1', status: 'RESOLVED', resolvedAt: new Date(), resolvedById: 'user-1',
      });

      const result = await service.updateNCRStatus('f-1', 'ncr-1', 'user-1', { status: 'RESOLVED' as any });
      expect(mockPrisma.nCR.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ resolvedAt: expect.any(Date), resolvedById: 'user-1' }),
      }));
    });
  });

  // ─── CAPA Workflow ────────────────────────────────────────

  describe('verifyCAPA', () => {
    it('verifies a CAPA when all actions are completed', async () => {
      mockPrisma.cAPA.findFirst.mockResolvedValueOnce({
        id: 'capa-1', status: 'IN_PROGRESS', factoryId: 'f-1',
        actions: [
          { id: 'a-1', status: 'COMPLETED' },
          { id: 'a-2', status: 'COMPLETED' },
        ],
      });
      mockPrisma.cAPA.update.mockResolvedValueOnce({
        id: 'capa-1', status: 'VERIFIED', verifiedAt: new Date(),
      });

      const result = await service.verifyCAPA('f-1', 'capa-1', 'user-1', {
        effectiveness: 'No recurrence in 30 days',
      });
      expect(result.status).toBe('VERIFIED');
    });

    it('rejects verification when actions are pending', async () => {
      mockPrisma.cAPA.findFirst.mockResolvedValueOnce({
        id: 'capa-1', status: 'IN_PROGRESS', factoryId: 'f-1',
        actions: [
          { id: 'a-1', status: 'COMPLETED' },
          { id: 'a-2', status: 'OPEN' }, // still pending
        ],
      });

      await expect(service.verifyCAPA('f-1', 'capa-1', 'user-1', { effectiveness: 'good' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('addCAPAAction', () => {
    it('adds action and moves CAPA to IN_PROGRESS', async () => {
      mockPrisma.cAPA.findFirst.mockResolvedValueOnce({
        id: 'capa-1', status: 'OPEN', factoryId: 'f-1',
      });
      mockPrisma.cAPA.update.mockResolvedValueOnce({ id: 'capa-1', status: 'IN_PROGRESS' });
      mockPrisma.cAPAAction.create.mockResolvedValueOnce({
        id: 'action-1', description: 'Recalibrate sensor', status: 'OPEN',
      });

      const action = await service.addCAPAAction('f-1', 'capa-1', {
        description: 'Recalibrate sensor',
      });
      expect(action.status).toBe('OPEN');
      expect(mockPrisma.cAPA.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'IN_PROGRESS' },
      }));
    });
  });

  // ─── Inspection ───────────────────────────────────────────

  describe('createInspection', () => {
    it('sets result to PASS when failQty is 0', async () => {
      mockPrisma.factory.findFirst.mockResolvedValueOnce({ id: 'f-1' });
      mockPrisma.inspectionResult.findFirst.mockResolvedValueOnce({
        id: 'i-1', inspectionNumber: 'INS-20260606-0001', factoryId: 'f-1',
      });
      mockPrisma.inspectionResult.create.mockResolvedValueOnce({
        id: 'new-ins', inspectionNumber: 'INS-20260606-0001', result: 'PASS',
        totalQty: 100, passQty: 100, failQty: 0,
        inspector: { name: 'Inspector A' },
      });

      const result = await service.createInspection('f-1', 'user-1', {
        type: 'IN_PROCESS' as any,
        totalQty: 100,
        passQty: 100,
        failQty: 0,
      });
      expect(mockPrisma.inspectionResult.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: 'PASS' }),
      }));
    });

    it('sets result to FAIL when passQty is 0', async () => {
      mockPrisma.factory.findFirst.mockResolvedValueOnce({ id: 'f-1' });
      mockPrisma.inspectionResult.findFirst.mockResolvedValueOnce(null);
      mockPrisma.inspectionResult.create.mockResolvedValueOnce({
        id: 'new-ins', result: 'FAIL',
        inspector: { name: 'Inspector A' },
      });

      await service.createInspection('f-1', 'user-1', {
        type: 'FINAL' as any,
        totalQty: 20,
        passQty: 0,
        failQty: 20,
      });
      expect(mockPrisma.inspectionResult.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: 'FAIL' }),
      }));
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('quality.inspection.failed', expect.anything());
    });
  });
});
