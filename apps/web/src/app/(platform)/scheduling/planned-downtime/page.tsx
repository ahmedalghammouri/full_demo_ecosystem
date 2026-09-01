import { ScheduleView } from '@/features/scheduling/schedule-view';
import { PlannedDowntimeManager } from '@/features/shifts/planned-downtime-manager';

export const metadata = { title: 'Planned Downtime Schedule | Industry360' };

export default function PlannedDowntimeSchedulePage() {
  return (
    <div className="max-w-[1800px] mx-auto">
      <ScheduleView
        title="Planned Downtime Schedule"
        subtitle="Gantt of scheduled breaks, cleaning and planned stops per machine."
        defaultTypes={['PLANNED_DOWNTIME']}
      />
      <div className="px-6 pb-8 -mt-2">
        <PlannedDowntimeManager />
      </div>
    </div>
  );
}
