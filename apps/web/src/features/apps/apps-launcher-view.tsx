'use client';

/**
 * AppsLauncherView — an Odoo-style "Apps" home: every workspace as a large, colourful
 * tile, grouped by domain, with a hero banner, category filter chips, staggered
 * entrance + hover animations and a live search. Data comes from the shared
 * QUICK_ACTION_GROUPS (single source of truth).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Search, ArrowUpRight, X, Sparkles } from 'lucide-react';
import { QUICK_ACTION_GROUPS } from '@/lib/quick-actions';
import { cn } from '@/lib/utils';

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.02, delayChildren: 0.03 } },
};
const tile = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 22 } },
};

export function AppsLauncherView() {
  const { t } = useTranslation('apps');
  const catLabel = (c: string) => t(`categories.${c}`, { defaultValue: c });
  // App labels live in the catalog as English keys; resolve them through the
  // apps namespace (keySeparator off because labels contain dots, e.g. "Maint. Orders").
  const appLabel = (label: string) => t(label, { keySeparator: false, nsSeparator: false, defaultValue: label });
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let gs = QUICK_ACTION_GROUPS;
    if (cat !== 'all') gs = gs.filter((g) => g.category === cat);
    if (!needle) return gs;
    return gs
      .map((g) => ({
        ...g,
        actions: g.actions.filter(
          (a) => a.label.toLowerCase().includes(needle)
            || appLabel(a.label).toLowerCase().includes(needle)
            || g.category.toLowerCase().includes(needle)
            || catLabel(g.category).toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.actions.length > 0);
  }, [q, cat]);

  const total = QUICK_ACTION_GROUPS.reduce((n, g) => n + g.actions.length, 0);
  const shown = groups.reduce((n, g) => n + g.actions.length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 px-6 py-3.5 border-b border-border/50 bg-background/80 backdrop-blur-xl shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <LayoutGrid className="text-primary" size={18} />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-foreground leading-none">{t('title')}</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('subtitle', { count: total, groups: QUICK_ACTION_GROUPS.length })}</p>
        </div>
        <div className="ms-auto relative">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            className="h-9 w-48 sm:w-64 rounded-lg border border-border bg-background/60 ps-9 pe-8 text-sm outline-none focus:border-primary/50 focus:bg-background transition-colors"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Hero banner */}
        <div className="relative mx-6 mt-6 overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6">
          <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative flex items-center gap-2 text-primary">
            <Sparkles size={15} />
            <span className="text-[11px] font-semibold uppercase tracking-wider">{t('eyebrow')}</span>
          </div>
          <h2 className="relative mt-2 text-2xl font-bold tracking-tight text-foreground">{t('heroTitle')}</h2>
          <p className="relative mt-1 text-sm text-muted-foreground max-w-xl">{t('heroSubtitle')}</p>
        </div>

        {/* Category chips — wrap into rows/columns based on viewport width */}
        <div className="sticky top-0 z-10 px-6 py-3 bg-background/85 backdrop-blur-xl border-b border-border/30">
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={cat === 'all'} onClick={() => setCat('all')} label={t('all')} count={total} />
            {QUICK_ACTION_GROUPS.map((g) => {
              const GIcon = g.icon;
              return (
                <Chip
                  key={g.category}
                  active={cat === g.category}
                  onClick={() => setCat(cat === g.category ? 'all' : g.category)}
                  label={catLabel(g.category)}
                  count={g.actions.length}
                  icon={<GIcon size={13} className={g.accent} />}
                />
              );
            })}
          </div>
        </div>

        {/* Grid */}
        <div className="px-6 pb-8 pt-1">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
                <Search size={22} className="text-muted-foreground/60" />
              </div>
              <div className="text-sm font-medium text-foreground">{t('noMatch', { query: q })}</div>
              <button onClick={() => { setQ(''); setCat('all'); }} className="mt-2 text-xs text-primary hover:underline">{t('clearFilters')}</button>
            </div>
          ) : (
            <motion.div variants={container} initial="hidden" animate="visible" className="space-y-8">
              {groups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <section key={group.category}>
                    <div className="flex items-center gap-2.5 mb-3.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border/40">
                        <GroupIcon size={14} className={group.accent} />
                      </span>
                      <h2 className="text-sm font-semibold text-foreground">{catLabel(group.category)}</h2>
                      <span className="text-[10px] font-semibold text-muted-foreground tabular-nums px-1.5 py-0.5 rounded-full bg-muted/50">{group.actions.length}</span>
                      <span className="ml-2 h-px flex-1 bg-gradient-to-r from-border/60 to-transparent" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                      {group.actions.map((a) => {
                        const Icon = a.icon;
                        return (
                          <motion.div key={a.href + a.label} variants={tile} whileHover={{ y: -6 }} whileTap={{ scale: 0.96 }}>
                            <Link
                              href={a.href}
                              target={a.newTab ? '_blank' : undefined}
                              rel={a.newTab ? 'noopener noreferrer' : undefined}
                              className={cn('group relative block', a.tone)} // tone sets currentColor for icon + glow
                            >
                              {/* coloured glow on hover (element opacity → safe per-app colour) */}
                              <span className="pointer-events-none absolute -inset-1 rounded-3xl bg-current opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20" />
                              <div className="relative flex flex-col items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm transition-colors group-hover:border-current group-hover:bg-card">
                                {a.newTab && (
                                  <ArrowUpRight size={13} className="absolute right-2 top-2 text-muted-foreground/40 transition-colors group-hover:text-current" />
                                )}
                                <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-b from-muted/50 to-muted/10 transition-colors group-hover:border-current">
                                  {/* tone tint at rest, deepens on hover */}
                                  <span className="pointer-events-none absolute inset-0 bg-current opacity-[0.08] transition-opacity duration-300 group-hover:opacity-20" />
                                  <Icon size={26} className="relative transition-transform duration-300 group-hover:scale-110" />
                                  <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                                </span>
                                <span className="text-[11px] font-medium text-center leading-tight text-muted-foreground transition-colors group-hover:text-foreground line-clamp-2">
                                  {appLabel(a.label)}
                                </span>
                              </div>
                            </Link>
                          </motion.div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </motion.div>
          )}
          {q && groups.length > 0 && (
            <p className="mt-6 text-center text-[11px] text-muted-foreground">{t('shownOfTotal', { shown, total })}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary/50 bg-primary/15 text-foreground'
          : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:border-border hover:bg-card',
      )}
    >
      {icon}
      {label}
      <span className={cn('tabular-nums text-[10px]', active ? 'text-primary' : 'text-muted-foreground/70')}>{count}</span>
    </button>
  );
}
