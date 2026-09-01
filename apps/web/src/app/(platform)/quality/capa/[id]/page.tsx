import type { Metadata } from 'next';
import { CapaDetailView } from '@/features/quality/capa-detail-view';

export const metadata: Metadata = { title: 'CAPA Detail | i360' };

export default async function CapaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CapaDetailView capaId={id} />;
}
