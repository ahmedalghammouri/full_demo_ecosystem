'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Calculator, Database, Lightbulb, Target, GitCompareArrows } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { EXPLAINERS, EXPLAINER_LABELS, type Bi } from '@/lib/dashboard-explainers';

/**
 * DashboardInfo — a small info icon shown in a dashboard/analytics page header.
 * Clicking it opens a bilingual (EN/AR) modal explaining what the page shows,
 * how every metric is calculated, the data sources, benchmarks and how to act.
 *
 *   <DashboardInfo id="production-overview" />
 *
 * Content lives in src/lib/dashboard-explainers.ts (no i18n-json pollution).
 */
export function DashboardInfo({ id, className }: { id: string; className?: string }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const exp = EXPLAINERS[id];
  if (!exp) return null;

  const ar = (i18n.language ?? '').toLowerCase().startsWith('ar');
  const L = (b: Bi) => (ar ? b.ar : b.en);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={L(EXPLAINER_LABELS.open)}
        aria-label={L(EXPLAINER_LABELS.open)}
        className={cn(
          'inline-flex items-center justify-center h-7 w-7 rounded-full border border-border/60 text-muted-foreground',
          'hover:text-brand-400 hover:border-brand-500/40 hover:bg-brand-500/10 transition-colors',
          className,
        )}
      >
        <Info size={15} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info size={16} className="text-brand-400" />
              {L(exp.title)}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            {/* Overview */}
            <section>
              <p className="text-muted-foreground leading-relaxed">{L(exp.summary)}</p>
            </section>

            {/* Metrics & formulas */}
            {exp.metrics && exp.metrics.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  <Calculator size={13} className="text-brand-400" />{L(EXPLAINER_LABELS.metrics)}
                </h3>
                <div className="space-y-2.5">
                  {exp.metrics.map((m, i) => (
                    <div key={i} className="rounded-lg border border-border/50 p-3 bg-muted/10">
                      <div className="font-medium text-foreground">{L(m.name)}</div>
                      {m.formula && (
                        <code className="mt-1 block text-[12px] font-mono text-brand-300 bg-brand-500/10 rounded px-2 py-1 overflow-x-auto" dir="ltr">
                          {m.formula}
                        </code>
                      )}
                      <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">{L(m.desc)}</p>
                      {m.benchmark && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-emerald-400">
                          <Target size={12} className="mt-0.5 shrink-0" />
                          <span><span className="font-semibold">{L(EXPLAINER_LABELS.benchmark)}: </span>{L(m.benchmark)}</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Data sources */}
            {exp.dataSources && exp.dataSources.length > 0 && (
              <Section icon={<Database size={13} className="text-brand-400" />} title={L(EXPLAINER_LABELS.dataSources)}>
                {exp.dataSources.map((d, i) => (
                  <li key={i} className="text-[13px] text-muted-foreground leading-relaxed">{L(d)}</li>
                ))}
              </Section>
            )}

            {/* How to use */}
            {exp.howToUse && exp.howToUse.length > 0 && (
              <Section icon={<Lightbulb size={13} className="text-amber-400" />} title={L(EXPLAINER_LABELS.howToUse)}>
                {exp.howToUse.map((d, i) => (
                  <li key={i} className="text-[13px] text-muted-foreground leading-relaxed">{L(d)}</li>
                ))}
              </Section>
            )}

            {/* Consistency notes */}
            {exp.notes && exp.notes.length > 0 && (
              <Section icon={<GitCompareArrows size={13} className="text-violet-400" />} title={L(EXPLAINER_LABELS.notes)}>
                {exp.notes.map((d, i) => (
                  <li key={i} className="text-[13px] text-muted-foreground leading-relaxed">{L(d)}</li>
                ))}
              </Section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {icon}{title}
      </h3>
      <ul className="space-y-1.5 ps-4 list-disc marker:text-border">{children}</ul>
    </section>
  );
}
