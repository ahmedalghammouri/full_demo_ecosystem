import type { Metadata } from 'next';
import { QualityReportView } from '@/features/reports/quality-report-view';
export const metadata: Metadata = { title: 'Quality Reports | i360' };
export default function QualityReportPage() { return <QualityReportView />; }
