import type { Metadata } from 'next';
import { MaintenanceSparePartsView } from '@/features/maintenance/maintenance-spare-parts-view';
export const metadata: Metadata = { title: 'Spare Parts | i360' };
export default function SparePartsPage() { return <MaintenanceSparePartsView />; }
