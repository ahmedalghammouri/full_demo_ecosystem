import type { Metadata } from 'next';
import { ReportsPage } from '@/features/production/reports-page';

export const metadata: Metadata = { title: 'Production Reports | INDUSTRY360 MES' };

/**
 * One pack, several sheets — see the component. This route stays so links
 * already written down keep resolving; the sidebar carries the subject once.
 */
export default function Page() { return <ReportsPage />; }
