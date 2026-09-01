/**
 * Standalone runner for the Dashboard Center catalog seed — populates categories +
 * the built-in Industry360° dashboards + the full Grafana suite without running the
 * whole demo seed. Idempotent (slug/key-keyed upserts).
 *
 * Run:  docker exec i360-api npx ts-node prisma/seed-dashboard-center.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedDashboardCenter } from './seeds/dashboard-center.seed';

const prisma = new PrismaClient();

seedDashboardCenter(prisma)
  .then(() => console.log('✓ Dashboard Center seed complete'))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
