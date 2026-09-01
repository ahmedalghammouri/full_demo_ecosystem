import { ShiftConfigView } from '@/features/shifts/shift-config-view';

export const metadata = { title: 'Shift Configuration | Industry360' };

export default function ShiftsPage() {
  return (
    <div className="max-w-screen-2xl mx-auto">
      <ShiftConfigView />
    </div>
  );
}
