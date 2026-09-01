import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RecipeStatus } from '@prisma/client';

export interface CreateRecipeDto {
  skuId: string;
  processId?: string;
  code: string;
  version?: string;
  name: string;
  description?: string;
  batchSize?: number;
  batchUnit?: string;
  yieldPct?: number;
  cycleTimeSecs?: number;
  shelfLifeDays?: number;
  storageConditions?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
}

export interface RecipeIngredientDto {
  rawMaterialId: string;
  phase?: string;
  quantityPer: number;
  unit: string;
  scrapFactor?: number;
  isOptional?: boolean;
  notes?: string;
  sortOrder?: number;
}

const RECIPE_INCLUDE = {
  sku: { select: { id: true, code: true, name: true, itemNumber: true } },
  process: { select: { id: true, name: true, version: true } },
  approvedBy: { select: { id: true, name: true } },
  ingredients: {
    include: {
      rawMaterial: { select: { id: true, code: true, name: true, unit: true, unitCost: true } },
    },
    orderBy: [{ phase: 'asc' as const }, { sortOrder: 'asc' as const }],
  },
  _count: { select: { workOrders: true, ingredients: true } },
};

@Injectable()
export class RecipeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List ────────────────────────────────────────────────────

  async findAll(factoryId: string | null, filters: {
    search?: string;
    skuId?: string;
    status?: RecipeStatus;
    page?: number;
    limit?: number;
  }) {
    const { search, skuId, status, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: any = {
      ...factoryFilter,
      ...(skuId && { skuId }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.recipe.count({ where }),
      this.prisma.recipe.findMany({
        where,
        include: {
          sku: { select: { id: true, code: true, name: true, itemNumber: true, brand: true } },
          process: { select: { id: true, name: true, version: true } },
          approvedBy: { select: { id: true, name: true } },
          // Include the BOM rows so the expandable list shows ingredients (not just the count).
          ingredients: {
            include: {
              rawMaterial: { select: { id: true, code: true, name: true, unit: true, unitCost: true } },
            },
            orderBy: [{ phase: 'asc' as const }, { sortOrder: 'asc' as const }],
          },
          _count: { select: { workOrders: true, ingredients: true } },
        },
        orderBy: [{ sku: { name: 'asc' } }, { version: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Single ──────────────────────────────────────────────────

  async findById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, ...factoryFilter },
      include: RECIPE_INCLUDE,
    });
    if (!recipe) throw new NotFoundException('Recipe not found');

    // Compute estimated material cost per batch
    const materialCost = recipe.ingredients.reduce((sum, ing) => {
      const unitCost = ing.rawMaterial.unitCost ?? 0;
      const qty = ing.quantityPer * (1 + (ing.scrapFactor ?? 0) / 100);
      return sum + unitCost * qty;
    }, 0);

    return { ...recipe, estimatedMaterialCost: parseFloat(materialCost.toFixed(2)) };
  }

  // ── Create ──────────────────────────────────────────────────

  async create(factoryId: string | null, dto: CreateRecipeDto) {
    const resolvedFactoryId = factoryId ?? await this.resolveFactoryId();

    // Guard: unique skuId + version
    const existing = await this.prisma.recipe.findFirst({
      where: { skuId: dto.skuId, version: dto.version ?? '1.0' },
    });
    if (existing) {
      throw new BadRequestException(
        `Recipe version ${dto.version ?? '1.0'} already exists for this product`,
      );
    }

    return this.prisma.recipe.create({
      data: {
        factoryId: resolvedFactoryId,
        skuId: dto.skuId,
        processId: dto.processId ?? null,
        code: dto.code,
        version: dto.version ?? '1.0',
        name: dto.name,
        description: dto.description,
        batchSize: dto.batchSize,
        batchUnit: dto.batchUnit,
        yieldPct: dto.yieldPct,
        cycleTimeSecs: dto.cycleTimeSecs,
        shelfLifeDays: dto.shelfLifeDays,
        storageConditions: dto.storageConditions,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        notes: dto.notes,
      },
      include: RECIPE_INCLUDE,
    });
  }

  // ── Update ──────────────────────────────────────────────────

  async update(factoryId: string | null, id: string, dto: Partial<CreateRecipeDto>) {
    const recipe = await this.getOrThrow(factoryId, id);
    if (recipe.status === RecipeStatus.APPROVED) {
      throw new ForbiddenException('Approved recipes cannot be edited. Clone to a new version instead.');
    }
    if (recipe.status === RecipeStatus.OBSOLETE) {
      throw new ForbiddenException('Obsolete recipes cannot be edited.');
    }

    const { skuId: _skuId, code: _code, ...safeDto } = dto as any;
    return this.prisma.recipe.update({
      where: { id },
      data: {
        ...safeDto,
        ...(dto.effectiveFrom && { effectiveFrom: new Date(dto.effectiveFrom) }),
        ...(dto.effectiveTo && { effectiveTo: new Date(dto.effectiveTo) }),
      },
      include: RECIPE_INCLUDE,
    });
  }

  // ── Approve / Status transitions ─────────────────────────────

  async submitForReview(factoryId: string | null, id: string) {
    const recipe = await this.getOrThrow(factoryId, id);
    if (recipe.status !== RecipeStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT recipes can be submitted for review');
    }
    if (recipe.ingredients.length === 0) {
      throw new BadRequestException('Recipe must have at least one ingredient before submission');
    }
    return this.prisma.recipe.update({
      where: { id },
      data: { status: RecipeStatus.REVIEW },
      include: RECIPE_INCLUDE,
    });
  }

  async approve(factoryId: string | null, id: string, userId: string) {
    const recipe = await this.getOrThrow(factoryId, id);
    if (recipe.status !== RecipeStatus.REVIEW) {
      throw new BadRequestException('Only REVIEW recipes can be approved');
    }
    return this.prisma.recipe.update({
      where: { id },
      data: {
        status: RecipeStatus.APPROVED,
        approvedById: userId,
        approvedAt: new Date(),
        effectiveFrom: recipe.effectiveFrom ?? new Date(),
      },
      include: RECIPE_INCLUDE,
    });
  }

  async obsolete(factoryId: string | null, id: string) {
    const recipe = await this.getOrThrow(factoryId, id);
    if (recipe.status !== RecipeStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED recipes can be made obsolete');
    }
    return this.prisma.recipe.update({
      where: { id },
      data: { status: RecipeStatus.OBSOLETE, effectiveTo: new Date() },
      include: RECIPE_INCLUDE,
    });
  }

  // ── Clone to new version ─────────────────────────────────────

  async clone(factoryId: string | null, id: string, newVersion: string) {
    const source = await this.findById(factoryId, id);
    const resolvedFactoryId = factoryId ?? await this.resolveFactoryId();

    const existing = await this.prisma.recipe.findFirst({
      where: { skuId: source.skuId, version: newVersion },
    });
    if (existing) throw new BadRequestException(`Version ${newVersion} already exists`);

    const newCode = `${source.code}-v${newVersion.replace('.', '')}`;

    const cloned = await this.prisma.recipe.create({
      data: {
        factoryId: resolvedFactoryId,
        skuId: source.skuId,
        processId: source.processId,
        code: newCode,
        version: newVersion,
        name: source.name,
        description: source.description,
        batchSize: source.batchSize,
        batchUnit: source.batchUnit,
        yieldPct: source.yieldPct,
        cycleTimeSecs: source.cycleTimeSecs,
        shelfLifeDays: source.shelfLifeDays,
        storageConditions: source.storageConditions,
        notes: `Cloned from ${source.code} v${source.version}`,
        status: RecipeStatus.DRAFT,
        ingredients: {
          createMany: {
            data: source.ingredients.map(ing => ({
              rawMaterialId: ing.rawMaterialId,
              phase: ing.phase,
              quantityPer: ing.quantityPer,
              unit: ing.unit,
              scrapFactor: ing.scrapFactor,
              isOptional: ing.isOptional,
              notes: ing.notes,
              sortOrder: ing.sortOrder,
            })),
          },
        },
      },
      include: RECIPE_INCLUDE,
    });
    return cloned;
  }

  // ── Delete ──────────────────────────────────────────────────

  async delete(factoryId: string | null, id: string) {
    const recipe = await this.getOrThrow(factoryId, id);
    if (recipe.status !== RecipeStatus.DRAFT) {
      throw new ForbiddenException('Only DRAFT recipes can be deleted');
    }
    await this.prisma.recipe.delete({ where: { id } });
  }

  // ── Ingredient management ───────────────────────────────────

  async addIngredient(factoryId: string | null, recipeId: string, dto: RecipeIngredientDto) {
    await this.getOrThrow(factoryId, recipeId);
    return this.prisma.recipeIngredient.create({
      data: { recipeId, ...dto },
      include: { rawMaterial: { select: { id: true, code: true, name: true, unit: true, unitCost: true } } },
    });
  }

  async updateIngredient(ingredientId: string, dto: Partial<RecipeIngredientDto>) {
    const { rawMaterialId: _rm, ...safe } = dto as any;
    return this.prisma.recipeIngredient.update({
      where: { id: ingredientId },
      data: safe,
      include: { rawMaterial: { select: { id: true, code: true, name: true, unit: true, unitCost: true } } },
    });
  }

  async removeIngredient(ingredientId: string) {
    await this.prisma.recipeIngredient.delete({ where: { id: ingredientId } });
  }

  // ── Private helpers ─────────────────────────────────────────

  private async getOrThrow(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, ...factoryFilter },
      include: { ingredients: true },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');
    return recipe;
  }

  private async resolveFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new NotFoundException('No active factory');
    return factory.id;
  }
}
