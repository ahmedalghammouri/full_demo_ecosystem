import type { Metadata } from 'next';
import { OperatorHmiView } from '@/features/operator-hub/operator-hmi-view';

export const metadata: Metadata = { title: 'Shop Floor | Operation Hub' };

// The simplified, tablet-first operator screen (key info + core actions), not the
// full desktop ShopFloorView. Supervisors still get the full view on the platform.
export default function HubShopFloorPage() {
  return <OperatorHmiView />;
}
