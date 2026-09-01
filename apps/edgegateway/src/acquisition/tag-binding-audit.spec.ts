import { auditBindings, type AuditTag } from './config-audit';

/**
 * The configuration audit must name real traps and only real traps.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The first version compared a tag's name against `t.address` with `!==`.
 * `address` is a STRING column — it holds "100" and "40001" where the leading
 * digit carries meaning — so the comparison was always unequal and every tag on
 * the plant was flagged, the four that agree along with the three that do not.
 *
 * That failure is worse than no audit. Seven findings where three are real
 * teaches a reader to skim the list, and the next genuine mismatch goes past
 * them. So the rule is pinned in BOTH directions: a matching binding must
 * produce SILENCE, and only a real disagreement may speak.
 *
 * This imports the shipped function. An earlier draft re-implemented the rule
 * here to keep the test free of Nest, which meant the test could pass while the
 * service was wrong — the precise failure mode it was written to prevent. The
 * rule now lives in `config-audit.ts` with no I/O, so the real one is testable
 * directly.
 */

const counter = (code: string, address: string, machine: string, role: string, edge: string): AuditTag =>
  ({ code, address, tagType: 'COUNTER', counterRole: role, edgeType: edge, machine: { code: machine } });

describe('the tag binding audit', () => {
  it('says nothing when a name and an address agree', () => {
    // The bug that made the first version useless: "0" is a string, and
    // 0 !== "0" is true.
    expect(auditBindings('EDGECOUNTER01', [
      counter('EDGECOUNTER01_DI0_M01', '0', 'M1', 'TOTAL', 'RISING'),
      counter('EDGECOUNTER01_DI1', '1', 'M1', 'GOOD', 'RISING'),
    ])).toEqual([]);
  });

  it('names a tag whose address is not the one in its name', () => {
    const notes = auditBindings('EDGE_COUNTER_M03', [
      counter('EDGE_COUNTER_M03_DI3', '2', 'M3', 'GOOD', 'FALLING'),
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('named DI3 but reads input 2');
  });

  it('reproduces the plant exactly — four findings, not seven', () => {
    // The live configuration on 26 Aug 2026. Three genuine name mismatches and
    // one mixed pair; everything else agrees and must stay silent.
    const notes = auditBindings('EDGE_COUNTER_M03', [
      counter('EDGE_COUNTER_M02_DI1', '0', 'M2', 'GOOD', 'RISING'),
      counter('EDGE_COUNTER_M02_DI0', '1', 'M2', 'TOTAL', 'FALLING'),
      counter('EDGE_COUNTER_M03_DI3', '2', 'M3', 'GOOD', 'FALLING'),
      counter('EDGE_COUNTER_M04_DI3', '3', 'M4', 'GOOD', 'RISING'),
    ]);
    expect(notes).toHaveLength(4);
    expect(notes.filter((n) => n.includes('named DI'))).toHaveLength(3);
    expect(notes.find((n) => n.includes('two different edges'))).toContain('M2');
  });

  it('leaves a machine alone when its counters share one edge', () => {
    expect(auditBindings('D', [
      counter('D_DI0', '0', 'M1', 'TOTAL', 'RISING'),
      counter('D_DI1', '1', 'M1', 'GOOD', 'RISING'),
    ])).toEqual([]);
  });

  it('catches two live tags reading one input', () => {
    const notes = auditBindings('D', [
      counter('D_DI2', '2', 'M3', 'GOOD', 'FALLING'),
      counter('D_DI2_TOTAL', '2', 'M3', 'TOTAL', 'FALLING'),
    ]);
    expect(notes.find((n) => n.includes('read by 2 active tags'))).toBeTruthy();
  });

  it('skips an address that is not a number rather than guessing', () => {
    // Register addresses like "40001" are numeric, but a malformed one must not
    // become a finding invented out of NaN.
    expect(auditBindings('D', [
      { code: 'D_DI1', address: 'coil-1', tagType: 'COUNTER', counterRole: 'GOOD', edgeType: 'RISING', machine: { code: 'M1' } },
    ])).toEqual([]);
  });

  it('ignores a tag whose name carries no DI number at all', () => {
    expect(auditBindings('D', [
      counter('M1_RUN_MODE', '2', 'M1', 'NONE', 'RISING'),
    ])).toEqual([]);
  });

  it('says nothing about a clean device', () => {
    // The state the plant should reach. Silence has to be reachable, or the
    // audit becomes background noise that nobody can ever clear.
    expect(auditBindings('CLEAN', [
      counter('CLEAN_DI0', '0', 'M1', 'TOTAL', 'RISING'),
      counter('CLEAN_DI1', '1', 'M1', 'GOOD', 'RISING'),
      counter('CLEAN_DI2', '2', 'M2', 'TOTAL', 'FALLING'),
      counter('CLEAN_DI3', '3', 'M2', 'GOOD', 'FALLING'),
    ])).toEqual([]);
  });
});
