import { ConflictException } from '@nestjs/common';
import { IotService } from './iot.service';

/**
 * Which tag drives a machine's state.
 *
 * Two rules, and they are enforced differently on purpose. One is a contradiction
 * in terms and is settled silently; the other is a real choice between two valid
 * tags and has to be put to whoever is configuring it.
 *
 * The distinction was learned the hard way. A first pass refused BOTH, and the
 * tag form could only produce the refused shape — it sent `signalRole` only when
 * "drives machine state" was ticked, so binding a PROCESSING signal was
 * impossible to express. A validator that rejects the only reachable shape is not
 * a validator, it is a wall.
 */
describe('IotService — binding a status signal', () => {
  function build(existingStatusTag: { code: string; machine?: { code: string } } | null = null) {
    const created: any[] = [];
    const updated: any[] = [];
    // `any`: individual tests replace findFirst with a two-case double, and a
    // return type inferred from this first one would reject the replacement.
    const prisma: any = {
      tagDefinition: {
        findFirst: jest.fn(async ({ where }: any) =>
          // The duplicate lookup; every other findFirst in these paths is the
          // "load the tag being edited" call, handled per test.
          where?.isMachineStatus === true ? existingStatusTag : null),
        create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'new', ...data }; }),
        update: jest.fn(async ({ data }: any) => { updated.push(data); return { id: 'x', ...data }; }),
      },
      factory: { findFirst: jest.fn().mockResolvedValue({ id: 'f1' }) },
      machine: { findUnique: jest.fn().mockResolvedValue({ id: 'm5', lineId: 'L1', areaId: 'A1' }) },
    };
    const svc = new IotService(prisma as never, { emit: jest.fn() } as never, {} as never);
    return { svc, prisma, created, updated };
  }

  /** The tag as it stands in the database before an edit. */
  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'tag-1', factoryId: 'f1', machineId: 'm5',
    isMachineStatus: false, signalRole: null, counterRole: null, tagType: 'STATUS',
    ...over,
  });

  // ── PROCESSING is not a state, and saying so is not the user's job ─────────
  it('stores a PROCESSING tag as not driving state, rather than refusing the save', async () => {
    // The exact body the tag form sends: it only reveals the signal-role field
    // once "drives machine state" is ticked, so this is the ONLY shape the UI can
    // produce for a processing signal. Refusing it left the field unbindable.
    const { svc, prisma, updated } = build();
    prisma.tagDefinition.findFirst = jest.fn(async ({ where }: any) =>
      where?.isMachineStatus === true ? null : existing({ isMachineStatus: true }));

    await svc.updateTag('f1', 'tag-1', {
      isMachineStatus: true, signalRole: 'PROCESSING',
      pulseWindowMs: 6000, pulseMinEdges: 4, idleThresholdMs: 10_000,
    });

    expect(updated[0].signalRole).toBe('PROCESSING');
    expect(updated[0].isMachineStatus).toBe(false);
  });

  it('does the same on create', async () => {
    const { svc, created } = build();
    await svc.createTag('f1', {
      code: 'M5_TABLE_ROTATION', name: 'Table rotation', dataType: 'BOOL',
      machineId: 'm5', isMachineStatus: true, signalRole: 'PROCESSING',
    });
    expect(created[0].isMachineStatus).toBe(false);
  });

  it('leaves a run-mode bit driving state', async () => {
    const { svc, created } = build();
    await svc.createTag('f1', {
      code: 'M5_RUN_MODE', name: 'Run mode', dataType: 'BOOL',
      machineId: 'm5', isMachineStatus: true, signalRole: 'RUN_MODE',
    });
    expect(created[0].isMachineStatus).toBe(true);
  });

  it('clears the flag when a status tag is re-bound as PROCESSING', async () => {
    // The repair path for the fault found live on 19 Aug 2026. It has to work
    // from the tag as it stands — flagged — or the bad row cannot be fixed.
    const { svc, prisma, updated } = build();
    prisma.tagDefinition.findFirst = jest.fn(async ({ where }: any) =>
      where?.isMachineStatus === true ? null : existing({ isMachineStatus: true, signalRole: 'RUN_MODE' }));

    await svc.updateTag('f1', 'tag-1', { signalRole: 'PROCESSING' });

    expect(updated[0].isMachineStatus).toBe(false);
  });

  // ── One machine, one state signal ─────────────────────────────────────────
  it('refuses a SECOND tag claiming to drive the same machine', async () => {
    // Not a contradiction in terms but a genuine choice between two valid tags,
    // and picking one silently would be picking for the plant.
    const { svc } = build({ code: 'M5_RUN_MODE', machine: { code: 'M5' } });
    await expect(svc.createTag('f1', {
      code: 'M5_OTHER', name: 'Other', dataType: 'BOOL',
      machineId: 'm5', isMachineStatus: true, signalRole: 'RUN_MODE',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps an already-flagged tag editable even while its machine has a clash', async () => {
    // The trap the first version fell into: with two flagged tags on M5, every
    // edit to EITHER was refused — including the edit that would clear one. A
    // machine could reach this state and not be edited out of it.
    const { svc, prisma, updated } = build();
    prisma.tagDefinition.findFirst = jest.fn(async ({ where }: any) =>
      where?.isMachineStatus === true
        ? { code: 'M5_TABLE_ROTATION', machine: { code: 'M5' } }
        : existing({ isMachineStatus: true, signalRole: 'RUN_MODE' }));

    await expect(svc.updateTag('f1', 'tag-1', { name: 'Renamed' })).resolves.toBeDefined();
    expect(updated[0].name).toBe('Renamed');
  });

  it('refuses moving a flagged tag onto a machine that already has one', async () => {
    // Turning the flag on and carrying it to a new machine are the same fault.
    const { svc, prisma } = build();
    prisma.tagDefinition.findFirst = jest.fn(async ({ where }: any) =>
      where?.isMachineStatus === true
        ? { code: 'M4_RUN_MODE', machine: { code: 'M4' } }
        : existing({ isMachineStatus: true, signalRole: 'RUN_MODE', machineId: 'm5' }));

    await expect(svc.updateTag('f1', 'tag-1', { machineId: 'm4' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not treat a tag with no machine as a clash', async () => {
    const { svc, created } = build({ code: 'SOMETHING', machine: { code: 'M5' } });
    await svc.createTag('f1', {
      code: 'ORPHAN', name: 'Orphan', dataType: 'BOOL',
      isMachineStatus: true, signalRole: 'RUN_MODE',
    });
    expect(created[0].isMachineStatus).toBe(true);
  });
});
