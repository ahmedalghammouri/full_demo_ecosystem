import type { Metadata } from 'next';
import { DowntimeCenterView } from '@/features/downtime-center/downtime-view';

export const metadata: Metadata = { title: 'Downtime Command Center' };

export default function DowntimeCenterPage() {
  return <DowntimeCenterView />;
}
