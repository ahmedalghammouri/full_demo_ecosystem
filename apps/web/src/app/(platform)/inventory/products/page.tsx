import type { Metadata } from 'next';
import { ProductsView } from '@/features/inventory/products-view';

export const metadata: Metadata = { title: 'Products — Inventory' };

export default function ProductsPage() {
  return <ProductsView />;
}
