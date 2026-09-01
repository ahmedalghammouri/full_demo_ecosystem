import type { Metadata } from 'next';
import { PlantLiveIndex } from '@/features/plant-dashboard/plant-live-index';

export const metadata: Metadata = { title: 'Plant Live Views' };

// Intermediate level (e.g. /plant-live-view/line) — lists published dashboards of
// that entity type instead of 404ing on a partial URL.
export default async function PlantLiveTypeIndexPage({
  params,
}: {
  params: Promise<{ entityType: string }>;
}) {
  const { entityType } = await params;
  return <PlantLiveIndex entityType={entityType} />;
}
