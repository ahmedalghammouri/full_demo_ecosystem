'use client';
/**
 * Database backups — take, restore, download, delete.
 *
 * The Odoo.sh model: the administrator can take a full dump at any moment, sees
 * every stored copy in one list, and can restore, download or delete each one.
 *
 * Two things this screen owes the reader, because they decide whether the
 * feature is trustworthy rather than merely present:
 *
 *   1. A restore REPLACES the entire database. It therefore demands the
 *      password again and a typed phrase, exactly like the reset flow — and the
 *      server takes an automatic safety copy first, which is named in the
 *      result so the way back is never a guess.
 *   2. Sizes, timestamps and the author are shown for every archive. A backup
 *      list that only shows filenames tells you nothing about which one you
 *      actually want at the moment you need it.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DatabaseBackup, Download, Trash2, RotateCcw, Loader2, AlertTriangle, ShieldCheck, Plus, Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export interface BackupRow {
  id: string;
  filename: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
  database: string;
  createdBy: string;
  kind: 'MANUAL' | 'SAFETY' | 'IMPORTED';
}

const RESTORE_PHRASE = 'RESTORE';

const fmtSize = (b: number) => {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * @param client an axios instance already carrying the elevated token — the
 *   same one the reset flow uses, so both halves of the danger zone
 *   authenticate identically.
 */
export function SystemBackups({ client }: { client: any }) {
  const { t } = useTranslation(['settings', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [label, setLabel] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRow | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['system', 'backups'],
    queryFn: async () => (await client.get('/system/backups')).data,
    staleTime: 10_000,
  });
  const backups: BackupRow[] = useMemo(() => {
    const raw = (data as any)?.data ?? data;
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['system', 'backups'] });

  /**
   * Upload an archive the operator already has locally.
   *
   * The download button has been here since the start, so copies have been leaving
   * this server with no way back in — a dump sitting on somebody's laptop was not a
   * backup you could actually restore from. This closes that loop.
   *
   * Progress is reported because these files are tens of megabytes over a WAN: a
   * button that simply looks stuck for a minute gets clicked again.
   */
  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      if (label.trim()) form.append('label', label.trim());
      setUploadPct(0);
      const res = await client.post('/system/backups/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // A restore-sized archive over a slow link needs longer than the default.
        timeout: 30 * 60_000,
        onUploadProgress: (ev: any) => {
          if (ev?.total) setUploadPct(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      return res.data;
    },
    onSuccess: (res: any) => {
      const meta = res?.data ?? res;
      toast({ title: t('backups.imported'), description: `${meta?.label ?? ''} · ${fmtSize(meta?.sizeBytes ?? 0)}` });
      setLabel('');
      invalidate();
    },
    onError: (e: any) => toast({
      title: t('backups.importFailed'),
      description: e?.response?.data?.message ?? e?.message,
      variant: 'destructive',
    }),
    onSettled: () => {
      setUploadPct(null);
      // Clear the input so choosing the SAME file again still fires a change event.
      if (fileInput.current) fileInput.current.value = '';
    },
  });

  const createMut = useMutation({
    mutationFn: async () => (await client.post('/system/backups', { label: label.trim() || undefined })).data,
    onSuccess: (res: any) => {
      const meta = res?.data ?? res;
      toast({ title: t('backups.created'), description: `${meta?.label ?? ''} · ${fmtSize(meta?.sizeBytes ?? 0)}` });
      setLabel('');
      invalidate();
    },
    onError: (e: any) => toast({
      title: t('backups.createFailed'),
      description: e?.response?.data?.message ?? e?.message,
      variant: 'destructive',
    }),
  });

  const restoreMut = useMutation({
    mutationFn: async () =>
      (await client.post(`/system/backups/${restoreTarget!.id}/restore`, { password, confirmation })).data,
    onSuccess: (res: any) => {
      const r = res?.data ?? res;
      toast({
        title: t('backups.restored'),
        description: t('backups.restoredDesc', { id: r?.safetyBackupId ?? '' }),
      });
      closeRestore();
      invalidate();
      // The whole client is now looking at data that no longer exists. Reloading
      // is the honest response — leaving stale screens up after a restore is how
      // somebody acts on a record that was rolled back a minute ago.
      setTimeout(() => window.location.reload(), 2500);
    },
    onError: (e: any) => toast({
      title: t('backups.restoreFailed'),
      description: e?.response?.data?.message ?? e?.message,
      variant: 'destructive',
    }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => (await client.delete(`/system/backups/${deleteTarget!.id}`)).data,
    onSuccess: () => {
      toast({ title: t('backups.deleted') });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: any) => toast({
      title: t('backups.deleteFailed'),
      description: e?.response?.data?.message ?? e?.message,
      variant: 'destructive',
    }),
  });

  const closeRestore = () => {
    setRestoreTarget(null);
    setPassword('');
    setConfirmation('');
  };

  /**
   * Download through the authenticated client, not a bare link.
   *
   * A plain <a href> carries no Authorization header, so the owner-guarded
   * endpoint would reject it — the file has to come back as a blob and be handed
   * to the browser from memory.
   */
  const download = async (row: BackupRow) => {
    setDownloading(row.id);
    try {
      const res = await client.get(`/system/backups/${row.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = row.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({
        title: t('backups.downloadFailed'),
        description: e?.response?.data?.message ?? e?.message,
        variant: 'destructive',
      });
    } finally {
      setDownloading(null);
    }
  };

  const restoreValid = password.length > 0 && confirmation.trim() === RESTORE_PHRASE;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/60 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4" /> {t('backups.title')}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{t('backups.subtitle')}</p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-[11px]">{t('backups.labelField')}</Label>
              <Input
                className="mt-1 h-9 w-56 text-xs"
                placeholder={t('backups.labelPlaceholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={() => createMut.mutate()} disabled={createMut.isPending || importMut.isPending}>
              {createMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" /> {t('backups.creating')}</>
                : <><Plus className="w-3.5 h-3.5 me-1.5" /> {t('backups.create')}</>}
            </Button>
            {/* The label field above applies to whichever of the two is used, so an
                uploaded archive can be named on the way in rather than arriving as
                an opaque filename. */}
            <input
              ref={fileInput}
              type="file"
              accept=".dump,application/octet-stream"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importMut.mutate(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={importMut.isPending || createMut.isPending}
              title={t('backups.importHint')}
            >
              {importMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" /> {uploadPct != null ? `${uploadPct}%` : t('backups.importing')}</>
                : <><Upload className="w-3.5 h-3.5 me-1.5" /> {t('backups.import')}</>}
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('backups.colLabel')}</TableHead>
                <TableHead>{t('backups.colWhen')}</TableHead>
                <TableHead>{t('backups.colSize')}</TableHead>
                <TableHead>{t('backups.colBy')}</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs py-6 text-muted-foreground">
                  {t('common:loading')}
                </TableCell></TableRow>
              )}
              {!!error && !isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs py-6 text-red-400">
                  {t('backups.listFailed')}
                </TableCell></TableRow>
              )}
              {!isLoading && !error && backups.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs py-6 text-muted-foreground">
                  {t('backups.empty')}
                </TableCell></TableRow>
              )}
              {backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">
                    <div className="font-medium flex items-center gap-2">
                      {b.label}
                      {b.kind === 'SAFETY' && (
                        <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-500">
                          <ShieldCheck className="w-3 h-3 me-1" />{t('backups.safety')}
                        </Badge>
                      )}
                      {/* Worth marking: an imported archive was produced somewhere
                          else, possibly by a different build or a different database,
                          so it deserves a second look before it replaces this one. */}
                      {b.kind === 'IMPORTED' && (
                        <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-400">
                          <Upload className="w-3 h-3 me-1" />{t('backups.importedTag')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">{b.filename}</div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtWhen(b.createdAt)}</TableCell>
                  <TableCell className={cn('text-xs', !b.sizeBytes && 'text-amber-500')}>{fmtSize(b.sizeBytes)}</TableCell>
                  <TableCell className="text-xs">{b.createdBy}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 px-2"
                        title={t('backups.download')}
                        disabled={!b.sizeBytes || downloading === b.id}
                        onClick={() => download(b)}>
                        {downloading === b.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Download className="w-3.5 h-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-500"
                        title={t('backups.restore')}
                        disabled={!b.sizeBytes}
                        onClick={() => setRestoreTarget(b)}>
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive"
                        title={t('backups.delete')}
                        onClick={() => setDeleteTarget(b)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-[11px] text-muted-foreground mt-3">{t('backups.storageNote')}</p>
      </div>

      {/* Restore — the destructive one */}
      <Dialog open={!!restoreTarget} onOpenChange={(o) => !o && closeRestore()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="w-5 h-5" /> {t('backups.restoreTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('backups.restoreDesc', { label: restoreTarget?.label ?? '', when: restoreTarget ? fmtWhen(restoreTarget.createdAt) : '' })}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs flex gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>{t('backups.safetyNote')}</span>
          </div>

          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs">{t('backups.password')}</Label>
              <Input type="password" className="mt-1" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <Label className="text-xs">{t('backups.typePhrase', { phrase: RESTORE_PHRASE })}</Label>
              <Input className="mt-1 font-mono" value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)} placeholder={RESTORE_PHRASE} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeRestore}>{t('common:cancel')}</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!restoreValid || restoreMut.isPending}
              onClick={() => restoreMut.mutate()}
            >
              {restoreMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" /> {t('backups.restoring')}</>
                : t('backups.restoreConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t('backups.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('backups.deleteDesc', { label: deleteTarget?.label ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t('common:cancel')}</Button>
            <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate()}>
              {deleteMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" /> …</>
                : t('backups.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
