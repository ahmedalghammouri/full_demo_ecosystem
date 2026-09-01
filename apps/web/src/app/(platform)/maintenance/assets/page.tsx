import type { Metadata } from 'next';
import { MaintenanceAssetsView } from '@/features/maintenance/maintenance-assets-view';
export const metadata: Metadata = { title: 'Assets | i360' };
export default function AssetsPage() { return <MaintenanceAssetsView />; }
