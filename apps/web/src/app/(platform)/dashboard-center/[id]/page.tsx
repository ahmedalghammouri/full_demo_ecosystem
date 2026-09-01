import { EmbeddedDashboardViewer } from '@/features/dashboard-center/embedded-dashboard-viewer';

export const metadata = { title: 'Dashboard | i360' };

export default async function EmbeddedDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EmbeddedDashboardViewer dashboardId={id} />;
}
