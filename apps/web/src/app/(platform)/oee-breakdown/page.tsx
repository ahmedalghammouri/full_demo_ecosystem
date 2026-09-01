import type { Metadata } from 'next';
import { OeeBreakdownView } from '@/features/oee-breakdown/oee-breakdown-view';

export const metadata: Metadata = { title: 'OEE Breakdown | i360' };

export default function Page() { return <OeeBreakdownView />; }
