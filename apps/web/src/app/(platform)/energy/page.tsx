import type { Metadata } from 'next';
import { EnergyOverview } from '@/features/energy/energy-overview';

export const metadata: Metadata = { title: 'Energy Monitoring' };

export default function EnergyPage() {
  return <EnergyOverview />;
}
