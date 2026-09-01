import type { Metadata } from 'next';
import { HistorianTrendView } from '@/features/iot/historian-trend-view';
export const metadata: Metadata = { title: 'Historian Trends | i360' };
export default function HistorianPage() { return <HistorianTrendView />; }
