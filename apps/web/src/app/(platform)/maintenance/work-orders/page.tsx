import type { Metadata } from 'next';
import { MaintenanceWorkOrdersView } from '@/features/maintenance/maintenance-work-orders-view';
export const metadata: Metadata = { title: 'Maintenance Work Orders | i360' };
export default function MaintenanceWOPage() { return <MaintenanceWorkOrdersView />; }
