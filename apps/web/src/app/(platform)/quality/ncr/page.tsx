import type { Metadata } from 'next';
import { QualityNcrView } from '@/features/quality/quality-ncr-view';
export const metadata: Metadata = { title: 'NCR Management | i360' };
export default function NcrPage() { return <QualityNcrView />; }
