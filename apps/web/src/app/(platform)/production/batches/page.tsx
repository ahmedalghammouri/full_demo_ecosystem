import type { Metadata } from 'next';
import { ProductionBatchesView } from '@/features/production/production-batches-view';
export const metadata: Metadata = { title: 'Production Batches | i360' };
export default function BatchesPage() { return <ProductionBatchesView />; }
