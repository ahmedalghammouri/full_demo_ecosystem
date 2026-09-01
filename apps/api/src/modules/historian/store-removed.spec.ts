import * as fs from 'fs';
import * as path from 'path';

/**
 * `production_snapshots` is gone — table, model, writer and all.
 *
 * ── The story this closes ───────────────────────────────────────────────────
 * It was the plant's fact store. `oee_minutes` was built BESIDE it rather than
 * on top of it, so the two could be compared before either was trusted. Over
 * every minute both covered, planned-stop and unmeasured minutes were identical
 * to the digit, good and scrap totals matched per machine, and run-versus-down
 * was conserved — minutes moved between the two, never in or out. The
 * differences were the two writers' minute classifiers, and the survivor is the
 * shared `classifyMinute`.
 *
 * Its last functional reader had never actually read it: the energy denominator
 * filtered `granularity: 'HOUR'` against a writer that only ever emitted MINUTE,
 * so it matched zero rows from the day it was written.
 *
 * The writer was stopped first and the rows kept as an independent check. With
 * the check made and recorded, the store is removed rather than left as a second
 * place a future reader could reach for.
 *
 * ── What must NOT come back ─────────────────────────────────────────────────
 * Any reference at all. A model reintroduced "just for history" is a second
 * store of the same fact, which is the condition this whole consolidation
 * removed.
 */

const SRC = path.resolve(__dirname, '..', '..');
const SCHEMA = path.resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('the old fact store is removed', () => {
  const files = walk(SRC);
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('the model is not in the schema', () => {
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    expect(schema).not.toContain('model ProductionSnapshot');
    expect(schema).not.toContain('production_snapshots');
    // And no orphan back-relation on a parent model.
    expect(schema).not.toMatch(/productionSnapshots\s+ProductionSnapshot/);
  });

  it('the writer and its backfill are deleted', () => {
    for (const f of ['production-snapshot.service.ts', 'production-snapshot.backfill.ts']) {
      expect(fs.existsSync(path.join(__dirname, f))).toBe(false);
    }
  });

  it('no code references it, in any form', () => {
    const offenders: string[] = [];
    for (const f of files) {
      // A spec legitimately names the thing it guards against.
      if (f.endsWith('.spec.ts')) continue;
      for (const [i, line] of fs.readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('--')) continue;
        if (/productionSnapshot|ProductionSnapshot|production_snapshots/.test(line)) {
          offenders.push(`${rel(f)}:${i + 1}  ${t.slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the compatibility view no longer claims to be a snapshot', () => {
    // `SNAPSHOT_COMPAT` never read that table — it is a projection of the minute
    // store wearing the old column names. The name outlived the table by long
    // enough to mislead, so it went too.
    const raw = fs.readFileSync(path.join(SRC, 'modules/production/kpi.service.ts'), 'utf8');
    // Split without escape sequences: CR stripped, then split on LF by code
    // point. A regex literal here is one backslash away from silently breaking.
    const code = raw
      .split(String.fromCharCode(13)).join('')
      .split(String.fromCharCode(10))
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('--'));
      })
      .join(String.fromCharCode(10));
    expect(code).toContain('export const MINUTE_FACTS');
    expect(code).not.toContain('SNAPSHOT_COMPAT');
    expect(code).toContain('FROM oee_minutes o');
  });

  it('would catch a reference coming back', () => {
    const re = /productionSnapshot|ProductionSnapshot|production_snapshots/;
    expect(re.test('await this.prisma.productionSnapshot.count();')).toBe(true);
    expect(re.test('SELECT * FROM production_snapshots')).toBe(true);
    expect(re.test('const rows = await this.prisma.oeeMinute.findMany();')).toBe(false);
  });
});
