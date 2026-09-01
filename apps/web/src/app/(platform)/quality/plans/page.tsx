import type { Metadata } from 'next';
import { QualityPlansView } from '@/features/quality/quality-plans-view';

export const metadata: Metadata = { title: 'Quality Plans' };

export default function QualityPlansPage() {
  return <QualityPlansView />;
}
