import type { Metadata } from 'next';
import { QualityOverview } from '@/features/quality/quality-overview';

export const metadata: Metadata = { title: 'Quality Management' };

export default function QualityPage() {
  return <QualityOverview />;
}
