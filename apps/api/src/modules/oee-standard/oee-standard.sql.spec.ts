import { OeeStandardService } from './oee-standard.service';

/**
 * The SQL these queries actually emit.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The engine shipped with every column unqualified, and three of its queries
 * join `machines`, `job_orders` and `work_orders` — all of which carry a
 * `factoryId` of their own. Postgres rejected the statement outright:
 *
 *   ERROR: column reference "factoryId" is ambiguous   (42702)
 *
 * It reached the browser because the account used to verify it was a
 * SUPER_ADMIN with no factory. The controller passes `user.factoryId`
 * straight through, so the predicate was never added and the broken branch was
 * the one branch the check could not take. Every user with a factory — which is
 * every real user — got a 500.
 *
 * So these tests build the SQL with a factory set, which is the shape that
 * failed, and assert the property that makes it safe: nothing in the WHERE or
 * SELECT names a column without saying which table it belongs to.
 */
describe('OeeStandardService — the SQL it emits', () => {
  /**
   * A prisma double that records the statement instead of running it. Enough to
   * check the text; a query that is well-formed here can still be wrong, which
   * is what the live scenario runs are for.
   */
  function build() {
    const seen: string[] = [];
    const prisma: any = {
      $queryRaw: jest.fn(async (sql: { strings?: string[]; sql?: string; text?: string }) => {
        // Prisma.sql exposes the assembled text differently across versions;
        // take whichever is present so this does not silently assert on ''.
        const text = sql.sql ?? sql.text ?? (sql.strings ?? []).join(' ? ');
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
        seen.push(text);
        return [];
      }),
    };
    return { svc: new OeeStandardService(prisma as never), seen };
  }

  const FROM = new Date('2026-08-20T00:00:00Z');
  const TO = new Date('2026-08-21T00:00:00Z');
  const FACTORY = 'factory-1';

  /**
   * Columns that exist on `oee_minutes` AND on a table one of these queries
   * joins. Naming one of these without a table prefix is the defect.
   */
  const SHARED_COLUMNS = ['factoryId', 'machineId', 'workOrderId', 'createdAt', 'id'];

  /** Every occurrence of `"col"` that is not preceded by an alias and a dot. */
  function unqualified(sql: string, column: string): number {
    let count = 0;
    const needle = `"${column}"`;
    for (let i = sql.indexOf(needle); i !== -1; i = sql.indexOf(needle, i + 1)) {
      const before = sql.slice(Math.max(0, i - 3), i);
      // `o."factoryId"` and `m."factoryId"` are fine; `AS "factoryId"` is an
      // output label rather than a reference, and cannot be ambiguous.
      if (/[A-Za-z0-9_]\.$/.test(before)) continue;
      if (/\bAS\s*$/i.test(sql.slice(Math.max(0, i - 4), i))) continue;
      count++;
    }
    return count;
  }

  /** Run every query in the service with a factory set, and hand back the SQL. */
  async function allQueries() {
    const { svc, seen } = build();
    const scope = {};
    await svc.totals(FACTORY, FROM, TO, scope);
    await svc.byMachine(FACTORY, FROM, TO, scope);
    await svc.byJobOrder(FACTORY, FROM, TO, scope);
    await svc.byShift(FACTORY, FROM, TO, scope);
    await svc.trend(FACTORY, FROM, TO, 'hour', scope);
    await svc.stateBreakdown(FACTORY, FROM, TO, scope);
    return seen;
  }

  it('names no shared column without its table, in any query', async () => {
    const queries = await allQueries();
    expect(queries.length).toBe(6);

    for (const sql of queries) {
      for (const column of SHARED_COLUMNS) {
        expect({ column, count: unqualified(sql, column), sql }).toEqual(
          expect.objectContaining({ column, count: 0 }),
        );
      }
    }
  });

  it('qualifies the factory predicate itself — the one that broke', async () => {
    const { svc, seen } = build();
    await svc.byMachine(FACTORY, FROM, TO, {});
    expect(seen[0]).toContain('o."factoryId"');
  });

  it('emits no factory predicate at all for a user without one', async () => {
    // The SUPER_ADMIN path. It works either way, which is exactly why it could
    // not be trusted to prove the other one does.
    const { svc, seen } = build();
    await svc.byMachine(null, FROM, TO, {});
    expect(seen[0]).not.toContain('"factoryId"');
  });

  it('keeps the line sub-query from colliding with the outer joins', async () => {
    // `machines` is already joined as `m` in two of these queries, so the
    // sub-query needs its own alias or the reference is ambiguous again.
    const { svc, seen } = build();
    await svc.byMachine(FACTORY, FROM, TO, { lineId: 'line-1' });
    expect(seen[0]).toContain('FROM machines m2');
    expect(seen[0]).toContain('m2."lineId"');
  });

  it('reads oee_minutes under the same alias everywhere', async () => {
    // One alias across the file is what lets SUMS be shared: the aggregate text
    // is written once and has to be valid inside every one of these queries.
    for (const sql of await allQueries()) {
      expect(sql).toContain('oee_minutes o');
    }
  });

  it('scopes every query to the requested window', async () => {
    for (const sql of await allQueries()) {
      expect(sql).toContain('o."bucketStart"');
    }
  });
});
