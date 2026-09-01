import { Injectable, Logger } from '@nestjs/common';
import { promises as fs, createReadStream, type ReadStream } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Local-disk file storage. Files are written under a mounted upload root
 * (UPLOAD_DIR, default <cwd>/uploads, i.e. /app/uploads in the container) and
 * served back through an authenticated API route — never directly from disk.
 *
 * Abstracted on purpose: swapping to MinIO/S3 later only touches this service,
 * not the attachments module or the frontend.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

  /** Persist a buffer; returns the relative storage key (forward-slashed). */
  async save(factoryId: string | null | undefined, originalName: string, buffer: Buffer): Promise<string> {
    const ext = path.extname(originalName || '').slice(0, 12).replace(/[^.\w]/g, '');
    const safeFactory = String(factoryId || 'shared').replace(/[^\w-]/g, '') || 'shared';
    const dir = path.join(this.root, safeFactory);
    await fs.mkdir(dir, { recursive: true });
    const rel = path.join(safeFactory, `${randomUUID()}${ext}`);
    await fs.writeFile(path.join(this.root, rel), buffer);
    return rel.split(path.sep).join('/');
  }

  /** Resolve a storage key to an absolute path, guarding against traversal. */
  private absolutePath(storageKey: string): string {
    const safe = path.normalize(storageKey).replace(/^([./\\])+/, '');
    const abs = path.join(this.root, safe);
    if (!abs.startsWith(path.resolve(this.root))) {
      throw new Error('Invalid storage key');
    }
    return abs;
  }

  stream(storageKey: string): ReadStream {
    return createReadStream(this.absolutePath(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.absolutePath(storageKey));
    } catch {
      this.logger.warn(`Could not delete file for key ${storageKey} (already gone?)`);
    }
  }
}
