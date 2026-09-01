'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { FactorySelector } from '@/features/factory-selector/factory-selector';
import { fetchDefaultDashboard } from '@/features/plant-dashboard/use-plant-dashboard';

export default function RootPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    // Land on the factory's default plant live view if one is set; else /apps.
    fetchDefaultDashboard()
      .then((d) => {
        if (cancelled) return;
        if (d?.entityType && d?.entityId) router.replace(`/plant-live-view/${d.entityType}/${d.entityId}`);
        else router.replace('/apps');
      })
      .catch(() => { if (!cancelled) router.replace('/apps'); });
    return () => { cancelled = true; };
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  return <FactorySelector />;
}
