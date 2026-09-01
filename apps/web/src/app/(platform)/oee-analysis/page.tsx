import type { Metadata } from 'next';
import { OeeAnalysisView } from '@/features/oee-analysis/oee-analysis-view';

export const metadata: Metadata = { title: 'OEE Analysis Overview | i360' };

export default function Page() { return <OeeAnalysisView />; }
