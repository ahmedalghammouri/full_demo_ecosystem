import type { Metadata } from 'next';
import { SparePartsView } from '@/features/inventory/spare-parts-view';

export const metadata: Metadata = { title: 'Spare Parts — Inventory' };

export default function SparePartsPage() {
  return <SparePartsView />;
}
