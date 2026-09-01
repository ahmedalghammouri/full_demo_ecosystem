import type { Metadata } from 'next';
import { DashboardBuilderView } from '@/features/plant-dashboard/dashboard-builder-view';

export const metadata: Metadata = { title: 'Dashboard Builder' };

export default async function DashboardBuilderPage({
  params,
}: {
  params: Promise<{ entityType: string; entityId: string }>;
}) {
  const { entityType, entityId } = await params;
  return <DashboardBuilderView entityType={entityType} entityId={entityId} />;
}
