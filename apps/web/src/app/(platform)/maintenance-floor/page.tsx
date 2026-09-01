import type { Metadata } from 'next';
import { MaintenanceFloorView } from '@/features/maintenance-floor/maintenance-floor-view';

export const metadata: Metadata = { title: 'Maintenance Floor | i360' };

export default function MaintenanceFloorPage() {
  return <MaintenanceFloorView />;
}
