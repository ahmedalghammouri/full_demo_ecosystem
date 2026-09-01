import type { Metadata } from 'next';
import { MaterialsView } from '@/features/inventory/materials-view';

export const metadata: Metadata = { title: 'Materials — Inventory' };

export default function MaterialsPage() {
  return <MaterialsView />;
}
