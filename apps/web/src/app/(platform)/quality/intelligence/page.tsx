import type { Metadata } from 'next';
import { QualityIntelligenceView } from '@/features/quality-intelligence/quality-view';

export const metadata: Metadata = { title: 'Quality Intelligence' };

export default function QualityIntelligencePage() {
  return <QualityIntelligenceView />;
}
