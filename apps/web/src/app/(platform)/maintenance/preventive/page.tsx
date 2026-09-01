import type { Metadata } from 'next';
import { MaintenancePreventiveView } from '@/features/maintenance/maintenance-preventive-view';
export const metadata: Metadata = { title: 'Preventive Maintenance | i360' };
export default function PreventivePage() { return <MaintenancePreventiveView />; }
