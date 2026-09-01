import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Importing an archive from the operator's machine.
 *
 * The download button has existed since this feature shipped, so copies have been
 * leaving the server with no way back in. Import closes that loop — and it is the
 * one place in the danger zone where a file the server did not produce becomes a
 * thing the server will later restore from.
 *
 * That is why validation happens BEFORE the archive is filed rather than during the
 * restore: by restore time the live database has already been dropped, and a bad
 * archive discovered then leaves the plant with nothing.
 */
describe('BackupService.importArchive', () => {
  // Several of these reach pg_restore, which is a process spawn. Under a full
  // parallel run that has exceeded jest's 5 s default and failed the suite for a
  // reason that had nothing to do with the code — a flaky test is worse than no
  // test, because it teaches people to re-run instead of read. The allowance is
  // set for the whole suite rather than per test, so a new case that also spawns
  // does not inherit the flake.
  jest.setTimeout(30_000);

  let dir: string;
  let BackupService: any;

  const user = { id: 'u1', email: 'admin@industry360.sa', factoryId: null, passwordHash: 'x' };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mes-backup-'));
    process.env.BACKUP_DIR = dir;
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/industry360';
    // BACKUP_DIR is read at module load, so the module must be re-required per test.
    jest.resetModules();
    ({ BackupService } = await import('./backup.service'));
  });

  /** A prisma double: the service only writes an audit row. */
  const svc = () => new BackupService({ auditLog: { create: jest.fn() } } as never);

  /** Stage a file the way multer would, and hand back the shape the service sees. */
  const staged = async (bytes: Buffer, originalname = 'copy.dump') => {
    const path = join(dir, 'upload-test.part');
    await writeFile(path, bytes);
    return { originalname, size: bytes.length, path };
  };

  it('refuses a file that is not a custom-format archive', async () => {
    // A plain .sql script is the likely mistake, and pg_restore cannot read one.
    const file = await staged(Buffer.from('-- PostgreSQL database dump\nCREATE TABLE x();'), 'dump.sql');
    await expect(svc().importArchive(user, file)).rejects.toThrow(/not a PostgreSQL custom-format archive/i);
  });

  it('leaves nothing behind on the volume when it refuses one', async () => {
    // A rejected upload that keeps its bytes fills the backups volume over time.
    const file = await staged(Buffer.from('not an archive'), 'notes.txt');
    await expect(svc().importArchive(user, file)).rejects.toThrow();

    const left = await readdir(dir);
    expect(left.filter((f) => f.endsWith('.part') || f.endsWith('.dump'))).toEqual([]);
  });

  it('refuses an empty file', async () => {
    const file = await staged(Buffer.alloc(0), 'empty.dump');
    await expect(svc().importArchive(user, file)).rejects.toThrow(/empty/i);
  });

  it('refuses when no file was sent at all', async () => {
    await expect(svc().importArchive(user, {} as never)).rejects.toThrow(/No file was uploaded/i);
  });

  it('does not write a sidecar for a rejected archive', async () => {
    // A sidecar is what makes a backup appear in the list. One written for an
    // archive that failed validation would offer a restore that cannot work.
    const file = await staged(Buffer.from('PGDMPnot-really'), 'truncated.dump');
    await svc().importArchive(user, file).catch(() => undefined);

    const left = await readdir(dir);
    expect(left.filter((f) => f.endsWith('.json'))).toEqual([]);
  });

  it('generates its own id and never trusts the uploaded filename', async () => {
    // The id becomes a path. "../../etc/passwd.dump" as a filename must not be able
    // to steer a write out of the backup directory.
    const file = await staged(Buffer.from('PGDMP-bad'), '../../escape.dump');
    await svc().importArchive(user, file).catch(() => undefined);

    const left = await readdir(dir);
    expect(left.some((f) => f.includes('escape'))).toBe(false);
  });
});
