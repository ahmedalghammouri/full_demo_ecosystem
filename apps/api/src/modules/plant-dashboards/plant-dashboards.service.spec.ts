import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlantDashboardsService } from './plant-dashboards.service';

// Minimal Prisma stub — only the calls the tested paths touch.
function makePrisma(overrides: any = {}) {
  return {
    plantDashboard: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    plantDashboardWidget: { deleteMany: jest.fn(), createMany: jest.fn() },
    machine: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    machineCurrentStatus: { findMany: jest.fn().mockResolvedValue([]) },
    factory: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    area: { findFirst: jest.fn() },
    productionLine: { findFirst: jest.fn() },
    alarmEvent: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
    ...overrides,
  };
}

const actor = { id: 'u1', factoryId: 'f1', role: 'FACTORY_ADMIN' };
const kpi = {} as any;
const energy = {} as any;
const storage = {} as any;

describe('PlantDashboardsService', () => {
  describe('validate', () => {
    it('flags a kpiValue card with no KPI and no scope', async () => {
      const prisma = makePrisma();
      prisma.plantDashboard.findFirst.mockResolvedValue({
        id: 'd1', factoryId: 'f1', canvasSettings: { width: 1920, height: 1080 },
        widgets: [{ id: 'w1', widgetType: 'kpiValue', x: 0, y: 0, width: 200, height: 100, dataConfig: {}, scopeConfig: {} }],
      });
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      const errors = await svc.validate(actor, 'd1');
      const msgs = errors.map((e) => e.message).join(' | ');
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect(msgs).toMatch(/scope not set/);
      expect(msgs).toMatch(/KPI not selected/);
    });

    it('flags a card positioned outside the canvas', async () => {
      const prisma = makePrisma();
      prisma.plantDashboard.findFirst.mockResolvedValue({
        id: 'd1', factoryId: 'f1', canvasSettings: { width: 1920, height: 1080 },
        widgets: [{ id: 'w1', widgetType: 'text', x: 1900, y: 1000, width: 400, height: 300, dataConfig: {}, scopeConfig: {}, displayConfig: {} }],
      });
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      const errors = await svc.validate(actor, 'd1');
      expect(errors.some((e) => /outside the canvas/.test(e.message))).toBe(true);
    });

    it('passes a fully-bound card', async () => {
      const prisma = makePrisma();
      prisma.plantDashboard.findFirst.mockResolvedValue({
        id: 'd1', factoryId: 'f1', canvasSettings: { width: 1920, height: 1080 },
        widgets: [{ id: 'w1', widgetType: 'kpiValue', x: 10, y: 10, width: 200, height: 100, dataConfig: { kpiCode: 'OEE' }, scopeConfig: { scopeType: 'machine', scopeId: 'm1' }, refreshConfig: { intervalSec: 5 } }],
      });
      prisma.machine.findFirst.mockResolvedValue({ id: 'm1' });
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      const errors = await svc.validate(actor, 'd1');
      expect(errors).toEqual([]);
    });
  });

  describe('publish', () => {
    it('refuses to publish when validation fails', async () => {
      const prisma = makePrisma();
      prisma.plantDashboard.findFirst.mockResolvedValue({
        id: 'd1', factoryId: 'f1', canvasSettings: { width: 1920, height: 1080 },
        widgets: [{ id: 'w1', widgetType: 'kpiValue', x: 0, y: 0, width: 200, height: 100, dataConfig: {}, scopeConfig: {} }],
      });
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      await expect(svc.publish(actor, 'd1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.plantDashboard.update).not.toHaveBeenCalled();
    });

    it('snapshots widgets + settings on a valid publish', async () => {
      const prisma = makePrisma();
      const dash = {
        id: 'd1', name: 'D', factoryId: 'f1', version: 1,
        canvasSettings: { width: 1920, height: 1080 }, backgroundSettings: { fit: 'cover' }, backgroundImageUrl: 'x',
        widgets: [{ id: 'w1', widgetType: 'text', x: 0, y: 0, width: 100, height: 50, dataConfig: {}, scopeConfig: {}, displayConfig: { text: 'hi' } }],
      };
      prisma.plantDashboard.findFirst.mockResolvedValue(dash);
      prisma.plantDashboard.update.mockImplementation(({ data }: any) => ({ ...dash, ...data }));
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      await svc.publish(actor, 'd1');
      const arg = prisma.plantDashboard.update.mock.calls[0][0];
      expect(arg.data.status).toBe('published');
      expect(arg.data.version).toBe(2);
      expect(arg.data.publishedSnapshot.widgets).toHaveLength(1);
    });
  });

  describe('liveData', () => {
    it('resolves aggregated machine STATE (BREAKDOWN wins)', async () => {
      const prisma = makePrisma();
      prisma.machine.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
      prisma.machineCurrentStatus.findMany.mockResolvedValue([{ state: 'RUNNING' }, { state: 'BREAKDOWN' }]);
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      const res = await svc.liveData(actor, [{ widgetId: 'w1::STATE', kpiCode: 'STATE', scopeType: 'line', scopeId: 'l1' }] as any);
      expect(res.data[0].text).toBe('BREAKDOWN');
    });

    it('errors on an unknown KPI code', async () => {
      const prisma = makePrisma();
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      const res = await svc.liveData(actor, [{ widgetId: 'w1::NOPE', kpiCode: 'NOPE', scopeType: 'machine', scopeId: 'm1' }] as any);
      expect(res.data[0].error).toMatch(/Unknown KPI/);
    });
  });

  describe('getById', () => {
    it('throws when the dashboard is missing', async () => {
      const prisma = makePrisma();
      prisma.plantDashboard.findFirst.mockResolvedValue(null);
      const svc = new PlantDashboardsService(prisma as any, kpi, energy, storage);
      await expect(svc.getById(actor, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
