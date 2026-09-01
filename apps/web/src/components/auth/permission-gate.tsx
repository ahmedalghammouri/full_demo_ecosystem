'use client';
/**
 * Page-level permission gate.
 *
 * The sidebar already hides what a user may not open, but hiding a link is not
 * access control — the route is still reachable by typing the URL, and a page
 * that loads and then fills with 403s looks like a broken product rather than a
 * closed door.
 *
 * Wrap a page in this and it either renders, or says plainly that the user does
 * not have the permission and names it, so an administrator can grant it from
 * Access Control without anybody having to guess which key is missing.
 *
 * `permission` is optional: with none given, the gate resolves the requirement
 * from the current route through the same map the sidebar uses, so the two can
 * never drift apart.
 */
import React from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ShieldOff } from 'lucide-react';

import { useAuthStore } from '@/store/auth-store';
import { routePermission } from '@/lib/nav-permissions';

export function PermissionGate({
  permission,
  children,
}: {
  permission?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation(['common']);
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const required = permission ?? routePermission(pathname ?? undefined);
  if (!required) return <>{children}</>;

  // Decide only once the permission set is actually known. A session still
  // loading its profile has no permissions array yet, and refusing it there
  // would flash "access denied" at a user who is perfectly entitled.
  const known = user?.role === 'SUPER_ADMIN' || Array.isArray(user?.permissions);
  if (!known) return null;

  if (hasPermission(required)) return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h2 className="mt-4 text-base font-semibold">{t('common:permission.deniedTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('common:permission.deniedBody')}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('common:permission.required')}{' '}
          <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono">{required}</code>
        </p>
      </div>
    </div>
  );
}
