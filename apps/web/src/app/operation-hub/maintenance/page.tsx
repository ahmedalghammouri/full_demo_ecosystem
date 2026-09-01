import type { Metadata } from 'next';
import { MaintenanceFloorView } from '@/features/maintenance-floor/maintenance-floor-view';

export const metadata: Metadata = { title: 'Maintenance | Operation Hub' };

export default function HubMaintenancePage() {
  return <MaintenanceFloorView />;
}
