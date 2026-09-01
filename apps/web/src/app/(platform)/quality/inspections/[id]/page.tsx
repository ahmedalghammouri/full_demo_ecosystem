import type { Metadata } from 'next';
import { InspectionDetailView } from '@/features/quality/inspection-detail-view';

export const metadata: Metadata = { title: 'Inspection Detail | i360' };

export default async function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InspectionDetailView inspectionId={id} />;
}
