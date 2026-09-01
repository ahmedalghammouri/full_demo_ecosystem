import type { Metadata } from 'next';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SignalRulesView } from '@/features/iot/signal-rules-view';

export const metadata: Metadata = { title: 'Signal Interpretation | i360' };

// Administration surface, not a monitoring one: it decides what a signal means
// and what a stop costs. Gated on iot:signals, which only the admin roles hold
// by default — an administrator can grant it to an engineer from Access Control.
export default function SignalRulesPage() {
  return (
    <PermissionGate permission="iot:signals">
      <SignalRulesView />
    </PermissionGate>
  );
}
