import type { Metadata } from 'next';
import { LiveShiftView } from '@/features/live-shift/live-shift-view';

export const metadata: Metadata = { title: 'Live Shift | i360' };

export default function Page() { return <LiveShiftView />; }
