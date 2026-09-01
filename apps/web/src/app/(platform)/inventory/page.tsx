import type { Metadata } from 'next';
import { InventoryOverview } from '@/features/inventory/inventory-overview';

export const metadata: Metadata = { title: 'Inventory' };

export default function InventoryPage() {
  return <InventoryOverview />;
}
