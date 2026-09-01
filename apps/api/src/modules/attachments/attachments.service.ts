import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';

interface Actor { id: string; factoryId: string | null; name?: string | null }

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(factoryId: string | null, entityType: string, entityId: string, category?: string) {
    return this.prisma.attachment.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        entityType,
        entityId,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: Actor, dto: UploadAttachmentDto, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const storageKey = await this.storage.save(user.factoryId, file.originalname, file.buffer);
    return this.prisma.attachment.create({
      data: {
        factoryId: user.factoryId ?? '',
        entityType: dto.entityType,
        entityId: dto.entityId,
        category: dto.category === 'INSTRUCTION' ? 'INSTRUCTION' : 'EVIDENCE',
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        description: dto.description ?? null,
        uploadedById: user.id,
        uploadedByName: user.name ?? null,
      },
    });
  }

  /** Fetch metadata (factory-scoped) for download. */
  async getOne(factoryId: string | null, id: string) {
    const att = await this.prisma.attachment.findFirst({ where: { id, ...(factoryId ? { factoryId } : {}) } });
    if (!att) throw new NotFoundException('Attachment not found');
    return att;
  }

  stream(storageKey: string) {
    return this.storage.stream(storageKey);
  }

  async remove(factoryId: string | null, id: string) {
    const att = await this.getOne(factoryId, id);
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.delete(att.storageKey);
    return { deleted: true };
  }
}
