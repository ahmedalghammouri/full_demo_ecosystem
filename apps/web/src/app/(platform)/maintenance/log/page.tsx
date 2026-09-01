import type { Metadata } from 'next';
import { MaintenanceLogView } from '@/features/maintenance/maintenance-log-view';

export const metadata: Metadata = { title: 'Maintenance Log | i360' };

export default function MaintenanceLogPage() {
  return <MaintenanceLogView />;
}
