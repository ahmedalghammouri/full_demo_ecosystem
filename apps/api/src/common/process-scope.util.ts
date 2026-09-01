import { Prisma } from '@prisma/client';

/**
 * THE canonical "which manufacturing process applies to this product" resolution.
 *
 * A process declares its covered products through its scope:
 *   PRODUCT       → exactly one SKU (skuId)
 *   PRODUCT_LIST  → explicit membership (ManufacturingProcessSku join rows)
 *   CATEGORY      → every active SKU sharing categoryId
 *   BASE_WEIGHT   → every active SKU sharing baseWeightId
 *
 * Resolution priority is most-specific first: PRODUCT → PRODUCT_LIST →
 * CATEGORY → BASE_WEIGHT, latest version wins inside each scope.
 * Every consumer (job-order generation, BOM derivation, planning,
 * downtime cascade, coverage reports) must resolve through this — never
 * through the legacy direct sku.manufacturingProcesses relation alone.
 */
export async function findProcessForSku<T = any>(
  prisma: any,
  factoryId: string | null,
  skuId: string,
  include?: Prisma.ManufacturingProcessInclude,
): Promise<T | null> {
  const factoryFilter = factoryId ? { factoryId } : {};
  const sku = await prisma.sKU.findFirst({
    where: { id: skuId, ...factoryFilter },
    select: { categoryId: true, baseWeightId: true },
  });
  if (!sku) return null;

  const scopeQueries: Prisma.ManufacturingProcessWhereInput[] = [
    { scopeType: 'PRODUCT', skuId },
    { scopeType: 'PRODUCT_LIST', skuLinks: { some: { skuId } } },
    ...(sku.categoryId ? [{ scopeType: 'CATEGORY' as const, categoryId: sku.categoryId }] : []),
    ...(sku.baseWeightId ? [{ scopeType: 'BASE_WEIGHT' as const, baseWeightId: sku.baseWeightId }] : []),
  ];

  for (const scopeWhere of scopeQueries) {
    const p = await prisma.manufacturingProcess.findFirst({
      where: { ...scopeWhere, ...factoryFilter, isActive: true },
      ...(include ? { include } : {}),
      orderBy: { version: 'desc' },
    });
    if (p) return p as T;
  }
  return null;
}

/** Prisma where-input selecting every SKU a process scope covers. */
export function processCoveredSkusWhere(p: {
  scopeType: string;
  skuId?: string | null;
  categoryId?: string | null;
  baseWeightId?: string | null;
  skuLinks?: Array<{ skuId: string }>;
}, factoryId?: string | null): Prisma.SKUWhereInput {
  const factoryFilter = factoryId ? { factoryId } : {};
  switch (p.scopeType) {
    case 'PRODUCT_LIST':
      return { id: { in: (p.skuLinks ?? []).map((l) => l.skuId) }, isActive: true, ...factoryFilter };
    case 'CATEGORY':
      return p.categoryId
        ? { categoryId: p.categoryId, isActive: true, ...factoryFilter }
        : { id: '__none__' };
    case 'BASE_WEIGHT':
      return p.baseWeightId
        ? { baseWeightId: p.baseWeightId, isActive: true, ...factoryFilter }
        : { id: '__none__' };
    default: // PRODUCT
      return p.skuId ? { id: p.skuId } : { id: '__none__' };
  }
}
