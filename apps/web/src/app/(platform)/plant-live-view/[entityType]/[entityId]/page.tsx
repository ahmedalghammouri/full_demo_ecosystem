import type { Metadata } from 'next';
import { PlantLiveView } from '@/features/plant-dashboard/plant-live-view';

export const metadata: Metadata = { title: 'Plant Live View' };

export default async function PlantLiveViewPage({
  params,
}: {
  params: Promise<{ entityType: string; entityId: string }>;
}) {
  const { entityType, entityId } = await params;
  return <PlantLiveView entityType={entityType} entityId={entityId} />;
}
