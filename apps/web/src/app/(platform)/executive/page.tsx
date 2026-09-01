import type { Metadata } from 'next';
import { ExecutiveView } from '@/features/executive/executive-view';

export const metadata: Metadata = { title: 'Executive Multi-Plant' };

export default function ExecutivePage() {
  return <ExecutiveView />;
}
