import type { Metadata } from 'next';
import { LiveProductionView } from '@/features/live/live-production-view';

export const metadata: Metadata = { title: 'Live Production | i360' };

export default function Page() { return <LiveProductionView />; }
