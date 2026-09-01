import type { Metadata } from 'next';
import { HarmonicsView } from '@/features/harmonics/harmonics-view';

export const metadata: Metadata = { title: 'Harmonics | i360' };

export default function HarmonicsPage() {
  return <HarmonicsView />;
}
