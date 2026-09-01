import { ScheduleView } from '@/features/scheduling/schedule-view';

export const metadata = { title: 'General Schedule | Industry360' };

export default function SchedulingPage() {
  return (
    <div className="max-w-[1800px] mx-auto">
      <ScheduleView />
    </div>
  );
}
