import { ScheduleView } from '@/features/scheduling/schedule-view';

export const metadata = { title: 'Unplanned Downtime Schedule | Industry360' };

export default function UnplannedDowntimeSchedulePage() {
  return (
    <div className="max-w-[1800px] mx-auto">
      <ScheduleView
        title="Unplanned Downtime Schedule"
        subtitle="Gantt of unplanned stops & breakdowns per machine — monitoring view."
        defaultTypes={['UNPLANNED_DOWNTIME']}
      />
    </div>
  );
}
