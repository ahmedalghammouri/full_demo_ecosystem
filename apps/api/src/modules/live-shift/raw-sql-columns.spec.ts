import * as fs from 'fs';
import * as path from 'path';

/**
 * Every column named in hand-written SQL exists on the table it is attributed to.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The live-shift query read `s."status"` and `s."statusSince"` from
 * `machine_current_status`. Neither column exists — the model calls them `state`
 * and has no "since" at all. Postgres said so plainly:
 *
 *   ERROR: column s.status does not exist   (42703)
 *
 * The engine already had a SQL spec, and it passed, because that suite checks
 * the TEXT of the statement — that every column is qualified with its table, the
 * fix for an earlier 42702. A column can be perfectly qualified and still not
 * exist. Text shape and schema truth are two different properties, and only the
 * first was being tested.
 *
 * Prisma's own client cannot help here: `$queryRaw` is opaque by design, so a
 * raw query is exactly the place where the compiler stops checking and nothing
 * else was checking either. This closes that gap by reading `schema.prisma` —
 * the same file the database is migrated from — and holding the raw SQL to it.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * It is not a SQL parser and does not try to be. It resolves aliases bound by a
 * plain `FROM table alias` / `JOIN table alias`, and checks only those. CTEs,
 * derived tables and lateral subqueries produce aliases with no table behind
 * them; those are skipped rather than guessed at. A guard that is right about
 * what it checks and silent elsewhere is worth more than one that invents
 * failures nobody can act on.
 */

const API_SRC = path.resolve(__dirname, '..', '..');
const SCHEMA = path.resolve(API_SRC, '..', 'prisma', 'schema.prisma');

/** Files whose raw SQL is held to the schema. Add a module when it grows one. */
const FILES = [
  'modules/live-shift/live-shift.service.ts',
  'modules/oee-standard/oee-standard.service.ts',
  'modules/oee-standard/state-timeline.service.ts',
  'modules/oee-standard/reject-reason.service.ts',
  'modules/oee-schedule/oee-schedule.service.ts',
];

/** table name → the columns it really has, from the Prisma schema. */
function readSchema(): Map<string, Set<string>> {
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const out = new Map<string, Set<string>>();

  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, model, body] = m;
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    const table = mapped ? mapped[1] : model;

    const cols = new Set<string>();
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = /^(\w+)\s+\S+/.exec(line);
      if (!field) continue;
      const renamed = /@map\("([^"]+)"\)/.exec(line);
      cols.add(renamed ? renamed[1] : field[1]);
    }
    out.set(table, cols);
  }
  return out;
}

/** The contents of every `Prisma.sql` template in a source file. */
function sqlBlocks(source: string): string[] {
  const blocks: string[] = [];
  const open = /Prisma\.sql`/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(source))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let end = -1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { i += 2; continue; }
      // `${` opens an interpolation that may itself contain a nested template.
      if (ch === '$' && source[i + 1] === '{') { depth++; i += 2; continue; }
      if (ch === '}' && depth > 0) { depth--; i++; continue; }
      if (ch === '`' && depth === 0) { end = i; break; }
      i++;
    }
    if (end === -1) break;
    blocks.push(source.slice(m.index + m[0].length, end));
    open.lastIndex = end;
  }
  return blocks;
}

/**
 * alias → table, for aliases bound to a REAL table.
 *
 * Anything bound to a CTE, a derived table or a lateral subquery is recorded as
 * unresolvable and excluded, rather than being matched against a table that
 * happens to share its name.
 */
function aliasMap(sql: string, known: Set<string>) {
  const bound = new Map<string, string>();
  const opaque = new Set<string>();

  // WITH x AS ( … ), y AS ( … ) — the names are relations with no schema behind them.
  for (const m of sql.matchAll(/(?:WITH|,)\s+(\w+)\s+AS\s*\(/gi)) opaque.add(m[1]);
  // `) alias` — a derived table or lateral subquery.
  for (const m of sql.matchAll(/\)\s+(\w+)\s+ON\b/gi)) opaque.add(m[1]);
  for (const m of sql.matchAll(/\)\s+AS\s+(\w+)/gi)) opaque.add(m[1]);

  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi)) {
    const [, table, alias] = m;
    const kw = ['ON', 'WHERE', 'GROUP', 'ORDER', 'LEFT', 'INNER', 'JOIN', 'LATERAL', 'AS', 'USING', 'LIMIT'];
    if (kw.includes(alias.toUpperCase())) continue;
    if (!known.has(table)) { opaque.add(alias); continue; }
    bound.set(alias, table);
  }
  for (const a of opaque) bound.delete(a);
  return bound;
}

describe('Raw SQL names columns that exist', () => {
  const schema = readSchema();

  it('parses the Prisma schema it is checking against', () => {
    expect(schema.size).toBeGreaterThan(50);
    // The exact table whose columns were guessed wrong.
    expect(schema.get('machine_current_status')).toBeDefined();
    expect(schema.get('machine_current_status')!.has('state')).toBe(true);
    expect(schema.get('machine_current_status')!.has('status')).toBe(false);
  });

  for (const rel of FILES) {
    it(`${rel} — every aliased column exists on its table`, () => {
      const source = fs.readFileSync(path.join(API_SRC, rel), 'utf8');
      const blocks = sqlBlocks(source);
      expect(blocks.length).toBeGreaterThan(0);

      const bad: string[] = [];
      for (const sql of blocks) {
        const aliases = aliasMap(sql, new Set(schema.keys()));
        for (const m of sql.matchAll(/\b(\w+)\."(\w+)"/g)) {
          const [, alias, column] = m;
          const table = aliases.get(alias);
          if (!table) continue; // CTE, derived table, or an alias we cannot resolve
          if (!schema.get(table)!.has(column)) {
            bad.push(`${alias}."${column}" — ${table} has no such column`);
          }
        }
      }
      expect(bad).toEqual([]);
    });
  }

  /**
   * The guard has to be able to fail. A checker that silently resolves nothing
   * passes every file forever, which is worse than not having one.
   */
  it('fails on a column that does not exist', () => {
    const sql = 'SELECT s."status" FROM machine_current_status s';
    const aliases = aliasMap(sql, new Set(schema.keys()));

    expect(aliases.get('s')).toBe('machine_current_status');
    expect(schema.get('machine_current_status')!.has('status')).toBe(false);
  });

  it('does not invent failures for CTE and lateral aliases', () => {
    const sql = `
      WITH scoped AS (SELECT o.* FROM oee_minutes o),
      fin AS (SELECT s2."workOrderId" FROM scoped s2)
      SELECT scoped."anythingAtAll", r."startTime"
      FROM scoped
      LEFT JOIN LATERAL (SELECT 1) r ON TRUE`;
    const aliases = aliasMap(sql, new Set(schema.keys()));

    expect(aliases.has('scoped')).toBe(false);
    expect(aliases.has('fin')).toBe(false);
    expect(aliases.has('r')).toBe(false);
    expect(aliases.get('o')).toBe('oee_minutes');
  });
});
