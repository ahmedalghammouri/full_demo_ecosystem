import { ApsView } from '@/features/aps/aps-view';

export const metadata = { title: 'Production Schedule — APS | Industry360' };

export default function ProductionSchedulePage() {
  return (
    <div className="max-w-[1800px] mx-auto">
      <ApsView />
    </div>
  );
}
