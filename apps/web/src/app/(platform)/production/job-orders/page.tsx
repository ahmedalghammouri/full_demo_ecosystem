import type { Metadata } from 'next';
import { JobOrdersView } from '@/features/production/job-orders-view';

export const metadata: Metadata = { title: 'Job Orders | i360' };

export default function JobOrdersPage() {
  return <JobOrdersView />;
}
