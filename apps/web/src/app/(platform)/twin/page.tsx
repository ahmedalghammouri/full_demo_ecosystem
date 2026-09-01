import type { Metadata } from 'next';
import { TwinView } from '@/features/twin/twin-view';

export const metadata: Metadata = { title: 'Digital Twin | i360' };

export default function TwinPage() {
  return <TwinView />;
}
