import type { Metadata } from 'next';
import { StockMovementsView } from '@/features/inventory/stock-movements-view';

export const metadata: Metadata = { title: 'Stock Movements | i360' };

export default function StockMovementsPage() {
  return <StockMovementsView />;
}
