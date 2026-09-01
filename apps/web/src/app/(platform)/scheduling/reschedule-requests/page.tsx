import { RescheduleRequestsView } from '@/features/scheduling/reschedule-requests-view';

export const metadata = { title: 'Reschedule Requests | Industry360' };

export default function RescheduleRequestsPage() {
  return (
    <div className="max-w-[1800px] mx-auto">
      <RescheduleRequestsView />
    </div>
  );
}
