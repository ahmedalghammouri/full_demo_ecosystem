import type { Metadata } from 'next';
import { ShopFloorView } from '@/features/shop-floor/shop-floor-view';

export const metadata: Metadata = { title: 'Shop Floor | i360' };

export default function ShopFloorPage() {
  return <ShopFloorView />;
}
