import type { Metadata } from 'next';
import { ProductionClient } from './production-client';

export const metadata: Metadata = { title: 'Production' };

export default function ProductionPage() {
  return <ProductionClient />;
}
