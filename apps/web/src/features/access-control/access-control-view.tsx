'use client';

/**
 * Access Control — the role × permission matrix editor (DB-backed RBAC).
 * Rows are permissions grouped by category; columns are the 12 roles. Toggling a
 * cell PATCHes a single grant (optimistic), taking effect within ~30s for live
 * sessions (permission cache TTL) and immediately on next login. SUPER_ADMIN and
 * FACTORY_ADMIN columns are fixed (always all) and rendered read-only.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Check, Loader2, Lock } from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

type Permission = { id: string; key: string; label: string; description?: string; category: string };
type Catalog = { roles: string[]; categories: { category: string; permissions: Permission[] }[]; total: number };
type Matrix = Record<string, string[]>;

const FIXED_ROLES = new Set(['SUPER_ADMIN', 'FACTORY_ADMIN']);
const shortRole = (r: string) => r.replace(/_/g, ' ').replace(/\bMANAGER\b/, 'Mgr').replace(/\bTECHNICIAN\b/, 'Tech').replace(/\bSUPERVISOR\b/, 'Spv');

export function AccessControlView() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: catalog } = useQuery<Catalog>({
    queryKey: ['rbac', 'catalog'],
    queryFn: () => api.get<Catalog>('/rbac/permissions'),
  });
  const { data: matrix } = useQuery<Matrix>({
    queryKey: ['rbac', 'matrix'],
    queryFn: () => api.get<Matrix>('/rbac/matrix'),
  });

  const [pending, setPending] = useState<Set<string>>(new Set());

  const toggle = useMutation({
    mutationFn: ({ role, permissionId, granted }: { role: string; permissionId: string; granted: boolean }) =>
      api.patch(`/rbac/roles/${role}/permissions/${permissionId}`, { granted }),
    onMutate: async ({ role, permissionId }) => {
      setPending((s) => new Set(s).add(`${role}:${permissionId}`));
      await qc.cancelQueries({ queryKey: ['rbac', 'matrix'] });
      const prev = qc.getQueryData<Matrix>(['rbac', 'matrix']);
      qc.setQueryData<Matrix>(['rbac', 'matrix'], (m) => {
        if (!m) return m;
        const held = new Set(m[role] ?? []);
        held.has(permissionId) ? held.delete(permissionId) : held.add(permissionId);
        return { ...m, [role]: [...held] };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['rbac', 'matrix'], ctx.prev);
      toast({ title: 'Update failed', description: 'Could not change this permission.', variant: 'destructive' });
    },
    onSettled: (_d, _e, { role, permissionId }) => {
      setPending((s) => { const n = new Set(s); n.delete(`${role}:${permissionId}`); return n; });
      qc.invalidateQueries({ queryKey: ['rbac', 'matrix'] });
    },
  });

  const held = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    if (matrix) for (const [role, ids] of Object.entries(matrix)) map[role] = new Set(ids);
    return map;
  }, [matrix]);

  const roles = catalog?.roles ?? [];

  const isOn = (role: string, permId: string) => FIXED_ROLES.has(role) || (held[role]?.has(permId) ?? false);

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <ShieldCheck className="text-primary" size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Access Control</h1>
          <p className="text-sm text-foreground/50">
            Which permissions each role holds. Changes apply within ~30 seconds for active sessions.
          </p>
        </div>
      </div>

      {!catalog || !matrix ? (
        <div className="flex items-center gap-2 text-foreground/50 py-10">
          <Loader2 className="animate-spin" size={16} /> Loading permission matrix…
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-start font-semibold px-3 py-2.5 border-b border-border/60 min-w-[240px] sticky start-0 bg-card">
                  Permission
                </th>
                {roles.map((role) => (
                  <th
                    key={role}
                    className="px-2 py-2.5 border-b border-border/60 text-[10px] font-semibold uppercase tracking-wide text-foreground/60 whitespace-nowrap"
                    title={role}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      {shortRole(role)}
                      {FIXED_ROLES.has(role) && <Lock size={10} className="text-foreground/30" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.categories.map((cat) => (
                <React.Fragment key={cat.category}>
                  <tr>
                    <td
                      colSpan={roles.length + 1}
                      className="px-3 py-1.5 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-foreground/50 sticky start-0"
                    >
                      {cat.category}
                    </td>
                  </tr>
                  {cat.permissions.map((perm) => (
                    <tr key={perm.id} className="hover:bg-accent/30">
                      <td className="px-3 py-2 border-b border-border/40 sticky start-0 bg-card">
                        <div className="font-medium text-foreground">{perm.label}</div>
                        <div className="text-[11px] text-foreground/40 font-mono">{perm.key}</div>
                      </td>
                      {roles.map((role) => {
                        const on = isOn(role, perm.id);
                        const fixed = FIXED_ROLES.has(role);
                        const busy = pending.has(`${role}:${perm.id}`);
                        return (
                          <td key={role} className="text-center border-b border-border/40 px-2 py-2">
                            <button
                              disabled={fixed || busy}
                              onClick={() => toggle.mutate({ role, permissionId: perm.id, granted: !on })}
                              className={cn(
                                'inline-flex items-center justify-center w-6 h-6 rounded-md border transition',
                                on
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'bg-transparent border-border/60 text-transparent hover:border-primary/60',
                                fixed && 'opacity-60 cursor-not-allowed',
                                busy && 'opacity-50',
                              )}
                              aria-label={`${on ? 'Revoke' : 'Grant'} ${perm.key} for ${role}`}
                            >
                              {busy ? <Loader2 size={12} className="animate-spin text-foreground/50" /> : on ? <Check size={14} /> : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
