'use client';

/**
 * Attachments — reusable file/image attachment panel for any entity
 * (maintenance work orders, quality inspections, NCRs, quality plans…).
 *
 * Two roles, via `category`:
 *   • INSTRUCTION — guides/specs uploaded by planners, shown to workers (read-only on tablet).
 *   • EVIDENCE    — photos/files a worker attaches during or after the job.
 *
 * Images render as thumbnails (fetched through the authenticated API as blobs)
 * with a click-to-zoom lightbox; other files show a download row. Fully i18n'd.
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, Trash2, FileText, Download, X, Loader2, Image as ImageIcon } from 'lucide-react';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export type AttachmentEntityType =
  | 'MAINTENANCE_WO' | 'QUALITY_INSPECTION' | 'NCR' | 'CAPA' | 'QUALITY_PLAN' | 'PM_PLAN';

export interface AttachmentRecord {
  id: string;
  entityType: string;
  entityId: string;
  category: 'INSTRUCTION' | 'EVIDENCE' | string;
  originalName: string;
  mimeType: string;
  size: number;
  description?: string | null;
  uploadedByName?: string | null;
  createdAt: string;
}

interface AttachmentsProps {
  entityType: AttachmentEntityType;
  entityId: string;
  category?: 'INSTRUCTION' | 'EVIDENCE';
  /** Hide the uploader (e.g. instructions shown read-only to a worker). */
  readOnly?: boolean;
  /** Optional heading; omit to render bare. */
  title?: string;
  className?: string;
  /** Accept attribute for the picker; defaults to images + pdf + office docs. */
  accept?: string;
}

const isImage = (m: string) => m.startsWith('image/');
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function Attachments({
  entityType, entityId, category, readOnly, title, className,
  accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx',
}: AttachmentsProps) {
  const { t } = useTranslation('common');
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const key = ['attachments', entityType, entityId, category ?? 'all'];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<AttachmentRecord[]>('/attachments', {
      params: { entityType, entityId, ...(category ? { category } : {}) },
    }),
    enabled: !!entityId,
    staleTime: 30_000,
  });
  const items = data ?? [];

  const uploadMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      fd.append('category', category ?? 'EVIDENCE');
      return api.upload<AttachmentRecord>('/attachments', fd);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t('attach.uploaded') }); },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? t('attach.uploadFailed'), variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t('attach.deleted') }); },
    onError: () => toast({ title: t('attach.deleteFailed'), variant: 'destructive' }),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => uploadMut.mutate(f));
    if (fileRef.current) fileRef.current.value = '';
  };

  const open = async (att: AttachmentRecord) => {
    try {
      const blob = await api.blob(`/attachments/${att.id}/download`);
      const url = URL.createObjectURL(blob);
      if (isImage(att.mimeType)) {
        setLightbox({ url, name: att.originalName });
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = att.originalName; a.target = '_blank';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch {
      toast({ title: t('attach.openFailed'), variant: 'destructive' });
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {(title || !readOnly) && (
        <div className="flex items-center justify-between">
          {title && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><Paperclip size={12} />{title}</p>}
          {!readOnly && (
            <>
              <input ref={fileRef} type="file" multiple accept={accept} className="hidden" onChange={onPick} />
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5" disabled={uploadMut.isPending || !entityId} onClick={() => fileRef.current?.click()}>
                {uploadMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {t('attach.add')}
              </Button>
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="shimmer h-12 rounded-lg" />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
          {readOnly ? t('attach.noneReadonly') : t('attach.none')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((att) => (
            <div key={att.id} className="group relative w-28 rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
              <button type="button" onClick={() => open(att)} className="w-full" title={att.originalName}>
                <div className="h-20 flex items-center justify-center bg-background/40">
                  {isImage(att.mimeType) ? <Thumb id={att.id} /> : <FileText size={26} className="text-muted-foreground" />}
                </div>
                <div className="px-1.5 py-1 text-left">
                  <p className="text-[10px] font-medium truncate">{att.originalName}</p>
                  <p className="text-[9px] text-muted-foreground">{fmtSize(att.size)}</p>
                </div>
              </button>
              <span className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isImage(att.mimeType) ? <ImageIcon size={11} className="text-white/80 drop-shadow" /> : <Download size={11} className="text-white/80 drop-shadow" />}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => deleteMut.mutate(att.id)}
                  disabled={deleteMut.isPending}
                  className="absolute top-1 right-1 p-0.5 rounded bg-black/50 text-white/80 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                  title={t('attach.delete')}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-6" onClick={() => { URL.revokeObjectURL(lightbox.url); setLightbox(null); }}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => { URL.revokeObjectURL(lightbox.url); setLightbox(null); }}><X size={22} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.name} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

/** Lazily fetches an image attachment as an authenticated blob and shows a thumbnail. */
function Thumb({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ['attachment-thumb', id],
    queryFn: async () => URL.createObjectURL(await api.blob(`/attachments/${id}/download`)),
    staleTime: 5 * 60_000,
  });
  if (!data) return <Loader2 size={16} className="animate-spin text-muted-foreground" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={data} alt="" className="h-20 w-full object-cover" />;
}
