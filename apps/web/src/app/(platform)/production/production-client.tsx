'use client';

import dynamic from 'next/dynamic';

const ProductionOverview = dynamic(
  () => import('@/features/production/production-overview').then(m => m.ProductionOverview),
  { ssr: false },
);

export function ProductionClient() {
  return <ProductionOverview />;
}
