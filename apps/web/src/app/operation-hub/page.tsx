'use client';

/**
 * Operation Hub launcher — large touch tiles for the shop-floor apps the signed-in
 * role is allowed to operate. Tiles are permission-gated (same keys as the backend
 * catalog), so an OPERATOR sees Shop Floor, a MAINTENANCE_TECHNICIAN sees
 * Maintenance, a quality inspector sees Quality Checks — each only what they hold.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Factory, Wrench, ClipboardCheck, type LucideIcon } from 'lucide-react';

import { useAuthStore } from '@/store/auth-store';

type Tile = {
  href: string;
  permission: string;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string; // tailwind color base, e.g. "sky"
};

const TILES: Tile[] = [
  {
    href: '/operation-hub/shop-floor',
    permission: 'shopfloor:operate',
    label: 'Shop Floor',
    description: 'Run job orders — start, pause, complete, log counts & downtime',
    icon: Factory,
    accent: 'sky',
  },
  {
    href: '/operation-hub/maintenance',
    permission: 'maintenancefloor:operate',
    label: 'Maintenance',
    description: 'Your assigned maintenance work orders — execute & attach evidence',
    icon: Wrench,
    accent: 'amber',
  },
  {
    href: '/operation-hub/quality',
    permission: 'qualityfloor:operate',
    label: 'Quality Checks',
    description: 'Record inspections against quality plans — measurements & pass/fail',
    icon: ClipboardCheck,
    accent: 'emerald',
  },
];

// Static class maps so Tailwind keeps these utilities (no dynamic string building).
const ACCENT: Record<string, { ring: string; iconBg: string; icon: string }> = {
  sky: { ring: 'hover:border-sky-400/60', iconBg: 'bg-sky-500/15', icon: 'text-sky-400' },
  amber: { ring: 'hover:border-amber-400/60', iconBg: 'bg-amber-500/15', icon: 'text-amber-400' },
  emerald: { ring: 'hover:border-emerald-400/60', iconBg: 'bg-emerald-500/15', icon: 'text-emerald-400' },
};

export default function OperationHubPage() {
  const router = useRouter();
  const { user, hasPermission } = useAuthStore();
  const tiles = TILES.filter((t) => hasPermission(t.permission));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-foreground/50 mt-1">Choose an app to begin your shift.</p>
      </div>

      {tiles.length === 0 ? (
        <div className="rounded-2xl border border-border/60 p-10 text-center text-foreground/50">
          No apps are assigned to your role yet. Please contact your supervisor.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map((t) => {
            const a = ACCENT[t.accent];
            const Icon = t.icon;
            return (
              <button
                key={t.href}
                onClick={() => router.push(t.href)}
                className={`group flex flex-col items-start gap-4 rounded-2xl border border-border/60 bg-card p-6 text-start transition active:scale-[0.98] ${a.ring}`}
              >
                <div className={`flex items-center justify-center w-14 h-14 rounded-2xl ${a.iconBg}`}>
                  <Icon className={a.icon} size={28} />
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground">{t.label}</div>
                  <div className="text-sm text-foreground/50 mt-1">{t.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
