import type { Metadata } from 'next';
import { QualityFloorView } from '@/features/quality-floor/quality-floor-view';

export const metadata: Metadata = { title: 'Quality Checks | Operation Hub' };

export default function HubQualityPage() {
  return <QualityFloorView />;
}
