import type { Metadata } from 'next';
import { PlantLiveIndex } from '@/features/plant-dashboard/plant-live-index';

export const metadata: Metadata = { title: 'Plant Live Views' };

export default function PlantLiveIndexPage() {
  return <PlantLiveIndex />;
}
