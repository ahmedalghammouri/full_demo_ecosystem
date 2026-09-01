import type { Metadata } from 'next';
import { MaintenanceReportView } from '@/features/reports/maintenance-report-view';
export const metadata: Metadata = { title: 'Maintenance Reports | i360' };
export default function MaintenanceReportPage() { return <MaintenanceReportView />; }
