import type { Metadata } from 'next';
import { EcosystemCoverageView } from '@/features/compliance/ecosystem-coverage-view';

export const metadata: Metadata = { title: 'Ecosystem Coverage | i360' };

export default function CompliancePage() {
  return <EcosystemCoverageView />;
}
