import { canBypass, canRestore, outputStepAfter, checkBypassPassword, BypassStep } from './step-bypass';

const step = (id: string, seq: number, name: string, bypassedAt: Date | null = null): BypassStep =>
  ({ id, sequenceOrder: seq, operationName: name, machineCode: id.toUpperCase(), bypassedAt });

const line = () => [
  step('m1', 1, 'Filling'),
  step('m2', 2, 'Cartoning'),
  step('m3', 3, 'Palletising'),
  step('m4', 4, 'Wrapping'),
];

describe('which step the line reads its output from', () => {
  it('is the last step when nothing is bypassed', () => {
    expect(outputStepAfter(line())?.id).toBe('m4');
  });

  it('is the step before the one about to be bypassed', () => {
    // What the tablet shows in the confirmation, before any password is typed.
    expect(outputStepAfter(line(), 'm4')?.id).toBe('m3');
  });

  it('skips over steps already bypassed', () => {
    const steps = line();
    steps[3].bypassedAt = new Date();
    expect(outputStepAfter(steps, 'm3')?.id).toBe('m2');
  });

  it('does not depend on the order the steps arrive in', () => {
    // They come from a query; an ORDER BY that changes must not change output.
    expect(outputStepAfter([...line()].reverse())?.id).toBe('m4');
  });
});

describe('what may be bypassed', () => {
  it('allows the last machine when others still count', () => {
    expect(canBypass(line(), 'm4')).toEqual({ ok: true });
  });

  it('allows a MIDDLE step too — a broken machine is not always the last', () => {
    expect(canBypass(line(), 'm2')).toEqual({ ok: true });
  });

  it('REFUSES the last step still counting', () => {
    // The failure this rule exists for: bypass everything and the line reports
    // it produced nothing, with no error anywhere.
    const steps = line();
    for (const s of steps.slice(1)) s.bypassedAt = new Date();
    const v = canBypass(steps, 'm1');
    expect(v.ok).toBe(false);
    expect((v as any).reason).toMatch(/last step still counting/i);
  });

  it('refuses a step that is already bypassed', () => {
    const steps = line();
    steps[3].bypassedAt = new Date();
    expect(canBypass(steps, 'm4').ok).toBe(false);
  });

  it('refuses a step belonging to another order', () => {
    expect(canBypass(line(), 'not-mine').ok).toBe(false);
  });
});

describe('restoring a step', () => {
  it('is allowed for a bypassed step', () => {
    const steps = line();
    steps[3].bypassedAt = new Date();
    expect(canRestore(steps, 'm4')).toEqual({ ok: true });
  });

  it('is refused for a step that was never bypassed', () => {
    expect(canRestore(line(), 'm4').ok).toBe(false);
  });

  it('is never blocked by the "last step" rule — restoring only ever adds one back', () => {
    const steps = line().map((s) => ({ ...s, bypassedAt: new Date() }));
    expect(canRestore(steps, 'm1')).toEqual({ ok: true });
  });
});

describe('the password gate', () => {
  it('accepts the plant password', () => {
    expect(checkBypassPassword('12345678')).toEqual({ ok: true });
  });

  it('rejects a wrong one, an empty one, and a missing one', () => {
    for (const bad of ['1234567', '', null, undefined, 12345678, {}]) {
      expect(checkBypassPassword(bad as never).ok).toBe(false);
    }
  });

  it('does not leak the password in the refusal', () => {
    const v = checkBypassPassword('wrong');
    expect((v as any).reason).not.toContain('12345678');
  });
});
