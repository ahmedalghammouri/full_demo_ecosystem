import type { Metadata } from 'next';
import { ArchiveView } from '@/features/archive/archive-view';

export const metadata: Metadata = { title: 'Archive | i360' };

export default function ArchivePage() {
  return <ArchiveView />;
}
