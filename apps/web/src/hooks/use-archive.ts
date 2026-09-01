'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';

/**
 * Archive / restore actions for any entity, wired to the generic archive API.
 * Pass the entity slug (as in ARCHIVE_ENTITIES) and the query keys to invalidate.
 *
 *   const { archive, restore } = useArchive('ncrs', [['quality', 'ncr']]);
 *   archive.mutate(id);  restore.mutate(id);
 */
export function useArchive(entity: string, invalidateKeys: QueryKey[], label = 'Record') {
  const qc = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    qc.invalidateQueries({ queryKey: ['archive'] });
  };
  const err = (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' });

  const archive = useMutation({
    mutationFn: (id: string) => api.patch(`/archive/${entity}/${id}/archive`, {}),
    onSuccess: () => { invalidate(); toast({ title: `${label} archived`, description: 'Hidden from active list — switch the filter to "Archived" to restore.' }); },
    onError: err,
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.patch(`/archive/${entity}/${id}/restore`, {}),
    onSuccess: () => { invalidate(); toast({ title: `${label} restored` }); },
    onError: err,
  });

  const bulkArchive = useMutation({
    mutationFn: (ids: string[]) => api.post(`/archive/${entity}/bulk-archive`, { ids }),
    onSuccess: (r: any) => { invalidate(); toast({ title: `Archived ${r?.count ?? ''} ${label.toLowerCase()}(s)` }); },
    onError: err,
  });
  const bulkRestore = useMutation({
    mutationFn: (ids: string[]) => api.post(`/archive/${entity}/bulk-restore`, { ids }),
    onSuccess: (r: any) => { invalidate(); toast({ title: `Restored ${r?.count ?? ''} ${label.toLowerCase()}(s)` }); },
    onError: err,
  });

  return { archive, restore, bulkArchive, bulkRestore };
}
