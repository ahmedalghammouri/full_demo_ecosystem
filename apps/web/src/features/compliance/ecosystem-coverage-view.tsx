'use client';

/**
 * Ecosystem Coverage.
 *
 * The Application Suite names 64 modules across four layers. This screen says
 * where the platform actually stands against that list — and it shows what is
 * **not** built as prominently as what is.
 *
 * That is the design decision worth defending. A capability matrix that hides
 * its gaps is a brochure; one that states them is a position a reviewer can
 * check, and the suite's own POC scope already prescribes locked modules. The
 * honest version is also the more persuasive one, because every claim left
 * standing is one the reviewer can go and verify on a screen.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Check, Minus, Lock, ArrowUpRight, Info } from 'lucide-react';
import { api } from '@/services/api.client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';

type Status = 'ACTIVE' | 'PARTIAL' | 'LOCKED';

interface ModuleRow {
  code: string; name: string; nameAr: string; status: Status;
  href: string | null; summary: string; summaryAr: string;
}
interface Layer {
  key: string; order: number; name: string; nameAr: string; role: string;
  total: number; score: number; pct: number;
  groups: { name: string; nameAr: string; modules: ModuleRow[] }[];
}
interface Coverage {
  scoring: { rule: string; caveat: string };
  total: number; score: number; pct: number;
  counts: { active: number; partial: number; locked: number };
  layers: Layer[];
}
interface FactoryRow {
  id: string; code: string; name: string; city: string | null; color: string;
  type: string | null; typeName: string | null; typeSummary: string | null;
  tagline: string | null; capabilityCount: number;
  capabilities: { code: string; label?: string; href?: string }[];
}

// Status is ordered, not categorical, and every mark ships with its label and
// its own icon — colour alone would collapse under deuteranopia and in print.
const STATUS: Record<Status, { label: string; icon: React.ElementType; cls: string }> = {
  ACTIVE:  { label: 'Implemented', icon: Check, cls: 'text-emerald-600 dark:text-emerald-400' },
  PARTIAL: { label: 'Partial',     icon: Minus, cls: 'text-amber-600 dark:text-amber-400' },
  LOCKED:  { label: 'Not built',   icon: Lock,  cls: 'text-muted-foreground' },
};

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EcosystemCoverageView() {
  const coverageQ = useQuery({
    queryKey: ['ecosystem-coverage'],
    queryFn: () => api.get<Coverage>('/ecosystem/coverage'),
    staleTime: 5 * 60_000,
  });
  const factoriesQ = useQuery({
    queryKey: ['ecosystem-factories'],
    queryFn: () => api.get<FactoryRow[]>('/ecosystem/factories'),
    staleTime: 5 * 60_000,
  });

  const c = coverageQ.data;
  const factories = factoriesQ.data ?? [];

  return (
    <PageShell loading={coverageQ.isLoading} kpiCount={4} showTable>
      <div className="px-6 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">Ecosystem Coverage</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The Application Suite defines {c?.total ?? 64} modules across four layers plus enterprise
          transformation and emerging technologies. This is where the platform stands against that
          list — including what is not built.
        </p>
      </div>

      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Overall
            </div>
            <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">
              {c ? `${c.pct}%` : '—'}
            </div>
            <div className="mt-2"><Bar pct={c?.pct ?? 0} /></div>
            <div className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
              {c ? `${c.score} of ${c.total} modules` : ''}
            </div>
          </CardContent>
        </Card>
        {(['ACTIVE', 'PARTIAL', 'LOCKED'] as Status[]).map((s) => {
          const meta = STATUS[s];
          const Icon = meta.icon;
          const n = c ? (s === 'ACTIVE' ? c.counts.active : s === 'PARTIAL' ? c.counts.partial : c.counts.locked) : null;
          return (
            <Card key={s}>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Icon size={13} className={meta.cls} />
                  {meta.label}
                </div>
                <div className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${meta.cls}`}>
                  {n ?? '—'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">modules</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── How this is scored ───────────────────────────────────────────── */}
      {c ? (
        <div className="px-6 pt-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <Info size={14} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-medium text-foreground">Scoring:</span> {c.scoring.rule}.{' '}
              {c.scoring.caveat}
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Layer by layer ───────────────────────────────────────────────── */}
      <div className="space-y-4 px-6 py-6">
        {(c?.layers ?? []).map((layer) => (
          <Card key={layer.key}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    <span className="font-mono text-muted-foreground">
                      {String(layer.order).padStart(2, '0')}
                    </span>{' '}
                    {layer.name}
                  </CardTitle>
                  <CardDescription>{layer.role}</CardDescription>
                </div>
                <div className="min-w-[140px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-lg font-semibold tabular-nums">{layer.pct}%</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {layer.score}/{layer.total}
                    </span>
                  </div>
                  <div className="mt-1.5"><Bar pct={layer.pct} /></div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {layer.groups.map((g) => (
                  <div key={g.name}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {g.name}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {g.modules.map((m) => {
                        const meta = STATUS[m.status];
                        const Icon = meta.icon;
                        const clickable = m.status !== 'LOCKED' && m.href;
                        const inner = (
                          <div
                            className={`flex h-full items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${
                              m.status === 'LOCKED'
                                ? 'border-dashed border-border bg-muted/30'
                                : 'border-border hover:border-primary/50 hover:bg-accent/40'
                            }`}
                          >
                            <Icon size={14} className={`mt-0.5 shrink-0 ${meta.cls}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`truncate text-sm font-medium ${
                                    m.status === 'LOCKED' ? 'text-muted-foreground' : ''
                                  }`}
                                >
                                  {m.name}
                                </span>
                                {clickable ? (
                                  <ArrowUpRight size={12} className="shrink-0 text-muted-foreground" />
                                ) : null}
                              </div>
                              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                                {m.summary}
                              </p>
                              {/* The status is written, not only coloured. */}
                              <span className={`mt-1 inline-block text-[10px] font-medium uppercase tracking-wide ${meta.cls}`}>
                                {meta.label}
                              </span>
                            </div>
                          </div>
                        );
                        return clickable ? (
                          <Link key={m.code} href={m.href!} className="block">{inner}</Link>
                        ) : (
                          <div key={m.code}>{inner}</div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── The estate ───────────────────────────────────────────────────── */}
      <div className="px-6 pb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What each site carries</CardTitle>
            <CardDescription>
              A factory's classification decides its modules, so no single site has everything —
              and that is the point. The estate covers the suite between them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {factories.map((f) => (
                <div key={f.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: f.color }}
                    />
                    <span className="font-mono text-sm font-semibold">{f.code}</span>
                    <span className="truncate text-xs text-muted-foreground">{f.city}</span>
                  </div>
                  <div className="mt-1.5 text-sm">{f.name}</div>
                  {f.typeName ? (
                    <Badge variant="outline" className="mt-2">{f.typeName}</Badge>
                  ) : null}
                  <p className="mt-2 text-xs leading-snug text-muted-foreground">
                    {f.typeSummary ?? f.tagline}
                  </p>
                  <div className="mt-3 border-t border-border pt-2.5">
                    <span className="font-mono text-lg font-semibold tabular-nums">
                      {f.capabilityCount}
                    </span>
                    <span className="ms-1.5 text-xs text-muted-foreground">modules on this site</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
