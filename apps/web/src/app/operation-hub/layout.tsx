'use client';

/**
 * Operation Hub — tablet-first chrome for shop-floor roles (OPERATOR,
 * MAINTENANCE_TECHNICIAN and anyone else granted `hub:operate`). Deliberately
 * NOT under the (platform) route group, so it renders WITHOUT the desktop
 * sidebar/scope shell. Auth + the hub-lock redirect are handled globally by
 * AuthProvider (mounted in the root Providers); this layout only paints the
 * chrome: a large-touch header with factory context, the operator, and logout.
 */

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, LayoutGrid, ChevronLeft } from 'lucide-react';

import { useAuthStore } from '@/store/auth-store';
import { authService } from '@/services/auth.service';

export default function OperationHubLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const isRoot = pathname === '/operation-hub';

  const handleLogout = () => {
    authService.logout();
    logout();
    router.replace('/');
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden select-none">
      <header className="flex items-center gap-3 h-16 px-4 sm:px-6 border-b border-border/60 shrink-0 bg-sidebar">
        {/* Back to launcher (hidden on the launcher itself) */}
        {!isRoot ? (
          <Link
            href="/operation-hub"
            className="flex items-center gap-1.5 h-11 px-3 rounded-xl text-sm font-semibold text-foreground/70 hover:bg-accent active:scale-95 transition"
          >
            <ChevronLeft size={18} /> Hub
          </Link>
        ) : (
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-[11px] text-[#003933]"
              style={{ background: 'linear-gradient(135deg, #E4D09F, #D9BB75)' }}
            >
              360°
            </div>
            <div className="leading-none">
              <div className="font-black text-[15px] tracking-tight">
                <span style={{ color: '#003933' }}>i</span>
                <span style={{ color: '#B08E42' }}>360°</span>
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40 mt-0.5">
                Operation Hub
              </div>
            </div>
          </div>
        )}

        <div className="ms-auto flex items-center gap-3">
          <div className="text-end leading-tight">
            <div className="text-sm font-semibold text-foreground">{user?.name ?? 'Operator'}</div>
            <div className="text-[11px] text-foreground/50">
              {user?.factory?.name ?? user?.factoryCode ?? '—'} · {user?.role?.replace(/_/g, ' ')}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-11 h-11 rounded-xl text-foreground/60 hover:bg-destructive/10 hover:text-destructive active:scale-95 transition"
            aria-label="Sign out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
