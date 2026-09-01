import type { Metadata } from 'next';
import { IotTagsView } from '@/features/iot/iot-tags-view';
export const metadata: Metadata = { title: 'Tag Browser | i360' };
export default function TagsPage() { return <IotTagsView />; }
