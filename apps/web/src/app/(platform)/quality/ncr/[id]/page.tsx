import type { Metadata } from 'next';
import { NcrDetailView } from '@/features/quality/ncr-detail-view';

export const metadata: Metadata = { title: 'NCR Detail | i360' };

export default async function NcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NcrDetailView ncrId={id} />;
}
