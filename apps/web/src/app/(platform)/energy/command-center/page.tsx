import type { Metadata } from 'next';
import { EnergyCenterView } from '@/features/energy-center/energy-view';

export const metadata: Metadata = { title: 'Energy Command Center' };

export default function EnergyCommandCenterPage() {
  return <EnergyCenterView />;
}
