import type { Metadata } from 'next';
import { PowerFactorView } from '@/features/power-factor/power-factor-view';

export const metadata: Metadata = { title: 'Power Factor | i360' };

export default function PowerFactorPage() {
  return <PowerFactorView />;
}
