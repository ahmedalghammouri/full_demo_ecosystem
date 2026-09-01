import type { Metadata } from 'next';
import { QualityCapaView } from '@/features/quality/quality-capa-view';
export const metadata: Metadata = { title: 'CAPA Management | i360' };
export default function CapaPage() { return <QualityCapaView />; }
