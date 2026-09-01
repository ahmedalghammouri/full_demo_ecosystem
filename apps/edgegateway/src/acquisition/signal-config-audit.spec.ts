import { ModbusPollerService } from './modbus-poller.service';

/**
 * Configuration that cannot work, caught at load rather than in production.
 *
 * Every fault below leaves the machine reading RUNNING — which is exactly what a
 * machine that IS running reads. Nothing on any screen distinguishes them, so the
 * plant finds out by eventually noticing that availability looks too good. The
 * point of these tests is that the gateway says so at startup instead.
 */
describe('ModbusPollerService — signal configuration audit', () => {
  function build() {
    const svc = new ModbusPollerService(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    const warnings: string[] = [];
    (svc as never as { logger: { warn(m: string): void } }).logger = {
      warn: (m: string) => { warnings.push(m); },
    } as never;
    const audit = (devices: unknown[], defaultInterval = 1000) =>
      (svc as never as {
        auditStatusTags(d: unknown[], i: number): Set<string>;
      }).auditStatusTags(devices, defaultInterval);
    return { audit, warnings };
  }

  const tag = (over: Record<string, unknown>) => ({
    id: 't-' + over.code, code: 'X', machineId: 'm1', isMachineStatus: true,
    signalRole: 'RUN_MODE', pulseWindowMs: 6000, pulseMinEdges: 4, ...over,
  });
  const device = (tags: unknown[], pollIntervalMs: number | null = 100) =>
    ({ name: 'EDGECOUNTER01', pollIntervalMs, tagDefinitions: tags });

  // ── A PROCESSING signal is not a state ────────────────────────────────────
  it('refuses to let a PROCESSING signal drive machine state', () => {
    // "The wrapping table is not turning" means no product is passing — which is
    // what STARVED is inferred FROM. Read as a state it says "broken", turning
    // every gap between pallets into a fault against the machine's availability.
    const { audit, warnings } = build();
    const drivers = audit([device([tag({ code: 'M5_TABLE_ROTATION', signalRole: 'PROCESSING' })])]);

    expect(drivers.size).toBe(0);
    expect(warnings.join(' ')).toMatch(/M5_TABLE_ROTATION.*cannot drive machine state/);
  });

  it('leaves the run-mode bit driving state when both are marked', () => {
    // The live configuration on 19 Aug 2026: M5 had a run-mode bit AND its table
    // rotation both flagged as the status signal. Both wrote the state on every
    // 100 ms poll, each overwriting the other.
    const { audit } = build();
    const drivers = audit([device([
      tag({ code: 'M5_RUN_MODE', signalRole: 'RUN_MODE' }),
      tag({ code: 'M5_TABLE_ROTATION', signalRole: 'PROCESSING' }),
    ])]);

    expect([...drivers]).toEqual(['t-M5_RUN_MODE']);
  });

  // ── One machine, one state signal ─────────────────────────────────────────
  it('picks one driver per machine and says which, rather than letting them fight', () => {
    const { audit, warnings } = build();
    const drivers = audit([device([
      tag({ code: 'B_SIGNAL', signalRole: null }),
      tag({ code: 'A_RUN', signalRole: 'RUN_MODE' }),
    ])]);

    expect([...drivers]).toEqual(['t-A_RUN']);           // run-mode wins
    expect(warnings.join(' ')).toMatch(/2 tags claim to drive its state/);
  });

  it('resolves a tie the same way on every restart', () => {
    // An arbitrary choice would make the machine's state depend on row order,
    // so a restart could silently change what the plant is being told.
    const { audit } = build();
    const one = audit([device([tag({ code: 'B', signalRole: null }), tag({ code: 'A', signalRole: null })])]);
    const two = audit([device([tag({ code: 'A', signalRole: null }), tag({ code: 'B', signalRole: null })])]);
    expect([...one]).toEqual([...two]);
  });

  it('ignores a status tag assigned to no machine', () => {
    const { audit, warnings } = build();
    expect(audit([device([tag({ code: 'ORPHAN', machineId: null })])]).size).toBe(0);
    expect(warnings.join(' ')).toMatch(/ORPHAN.*no machine/);
  });

  // ── A pulse nobody can see ────────────────────────────────────────────────
  it('warns when the poll rate cannot resolve a flashing lamp', () => {
    // The failure reported from the line on 19 Aug 2026: the lamp was flashed and
    // the machine stayed RUNNING. At 1000 ms a 1 Hz flash is sampled at the same
    // phase every cycle and reads as a steady level — no setting on the tag can
    // recover an edge that was never sampled.
    const { audit, warnings } = build();
    audit([device([tag({ code: 'M4_RUN_MODE', signalRole: 'RUN_MODE_PULSED' })], 1000)]);

    expect(warnings.join(' ')).toMatch(/M4_RUN_MODE.*1000 ms.*read as steady/);
  });

  it('stays quiet when the poll rate is fast enough', () => {
    // 100 ms resolves a 2.5 Hz flash — comfortably past any tower lamp.
    const { audit, warnings } = build();
    audit([device([tag({ code: 'M4_RUN_MODE', signalRole: 'RUN_MODE_PULSED' })], 100)]);
    expect(warnings).toEqual([]);
  });

  it('warns when the window is too short to hold the edges it demands', () => {
    const { audit, warnings } = build();
    audit([device([tag({
      code: 'M4_RUN_MODE', signalRole: 'RUN_MODE_PULSED', pulseWindowMs: 300, pulseMinEdges: 4,
    })], 100)]);
    expect(warnings.join(' ')).toMatch(/300 ms window cannot hold 4 edges/);
  });

  it('applies the pulse checks only to pulsed signals', () => {
    // A plain run-mode bit carries two states and is read by level. Sampling it
    // slowly delays a stop; it does not hide one.
    const { audit, warnings } = build();
    audit([device([tag({ code: 'M1_RUN_MODE', signalRole: 'RUN_MODE' })], 5000)]);
    expect(warnings).toEqual([]);
  });

  // ── Not a log flood ───────────────────────────────────────────────────────
  it('reports a standing fault once, not on every reload', () => {
    // Reload runs every few seconds. A warning repeated at that rate buries the
    // one that appears when something actually changes.
    const { audit, warnings } = build();
    const cfg = [device([tag({ code: 'M5_TABLE_ROTATION', signalRole: 'PROCESSING' })])];
    audit(cfg); audit(cfg); audit(cfg);
    expect(warnings).toHaveLength(1);
  });
});
