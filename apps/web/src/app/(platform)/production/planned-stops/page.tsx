import type { Metadata } from 'next';
import { PermissionGate } from '@/components/auth/permission-gate';
import { PlannedStopsView } from '@/features/shifts/planned-stops-view';

export const metadata: Metadata = { title: 'Planned Stops | i360' };

// Everything on this screen removes minutes from the OEE availability
// denominator, so it is gated the same way shift configuration is.
export default function PlannedStopsPage() {
  return (
    <PermissionGate permission="shifts:manage">
      <PlannedStopsView />
    </PermissionGate>
  );
}
