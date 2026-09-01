import type { Metadata } from 'next';
import { QualityInspectionsView } from '@/features/quality/quality-inspections-view';
export const metadata: Metadata = { title: 'Quality Inspections | i360' };
export default function InspectionsPage() { return <QualityInspectionsView />; }
