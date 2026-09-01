import { TraceabilityView } from '@/features/traceability/traceability-view';

export const metadata = { title: 'Genealogy | i360' };

export default function GenealogyPage() {
  return <TraceabilityView fixedTab="genealogy" />;
}
