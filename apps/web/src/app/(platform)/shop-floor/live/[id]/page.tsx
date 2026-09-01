import type { Metadata } from 'next';
import { JOLiveDashboard } from '@/features/shop-floor/jo-live-dashboard';

export const metadata: Metadata = { title: 'Live Dashboard | i360' };

export default async function JOLiveDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JOLiveDashboard jobOrderId={id} />;
}
