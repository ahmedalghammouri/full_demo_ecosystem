import type { Metadata } from 'next';
import { ReliabilityView } from '@/features/maintenance-reliability/reliability-view';

export const metadata: Metadata = { title: 'Reliability Command Center' };

export default function ReliabilityPage() {
  return <ReliabilityView />;
}
