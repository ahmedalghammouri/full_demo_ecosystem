import type { Metadata } from 'next';
import { EnergyMetersView } from '@/features/energy/energy-meters-view';

export const metadata: Metadata = { title: 'Energy Meters' };

export default function EnergyMetersPage() {
  return <EnergyMetersView />;
}
