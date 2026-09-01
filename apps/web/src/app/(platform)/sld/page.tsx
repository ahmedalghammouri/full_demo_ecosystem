import type { Metadata } from 'next';
import { SldView } from '@/features/sld/sld-view';

export const metadata: Metadata = { title: 'Single Line Diagram | i360' };

export default function SldPage() {
  return <SldView />;
}
