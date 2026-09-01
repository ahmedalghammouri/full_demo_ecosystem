import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
