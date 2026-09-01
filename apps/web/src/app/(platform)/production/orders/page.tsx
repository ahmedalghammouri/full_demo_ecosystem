import type { Metadata } from 'next';
import { ProductionWorkOrdersView } from '@/features/production/production-work-orders-view';

export const metadata: Metadata = { title: 'Work Orders | i360' };

export default function ProductionOrdersPage() {
  return <ProductionWorkOrdersView />;
}
