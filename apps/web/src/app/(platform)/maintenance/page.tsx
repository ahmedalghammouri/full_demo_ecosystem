import type { Metadata } from 'next';
import { MaintenanceOverview } from '@/features/maintenance/maintenance-overview';

export const metadata: Metadata = { title: 'Maintenance' };

export default function MaintenancePage() {
  return <MaintenanceOverview />;
}
