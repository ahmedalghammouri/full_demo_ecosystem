import type { Metadata } from 'next';
import { PowerQualityView } from '@/features/power-quality/power-quality-view';

export const metadata: Metadata = { title: 'Power Quality | i360' };

export default function PowerQualityPage() {
  return <PowerQualityView />;
}
