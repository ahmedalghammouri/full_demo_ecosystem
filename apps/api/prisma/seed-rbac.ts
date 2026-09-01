/**
 * Standalone runner for the RBAC seed — permission catalog + default role matrix.
 * Idempotent: catalog upserts every run; the matrix seeds only on first boot
 * (pass --force to reset roles to the shipped defaults).
 *
 * Run:  docker exec i360-api-prod npx ts-node prisma/seed-rbac.ts
 *       docker exec i360-api-prod npx ts-node prisma/seed-rbac.ts --force
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from './seeds/rbac.seed';

const prisma = new PrismaClient();
const force = process.argv.includes('--force');

seedRbac(prisma, { force })
  .then((r) => console.log(`✓ RBAC seed complete — ${r.permissions} permissions, grants: ${r.grants}`))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
