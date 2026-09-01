'use client';
import { useTranslation } from 'react-i18next';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TablePagination } from '@/components/ui/table-pagination';
import { motion } from 'framer-motion';
import {
  Users, UserPlus, Search, Shield, Mail, MoreHorizontal,
  CheckCircle, XCircle, ChevronDown, Pencil, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn, timeAgo } from '@/lib/utils';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
  isActive: boolean;
  lastLoginAt?: string;
  factory?: { code: string; name: string };
}

const roleColors: Record<string, string> = {
  SUPER_ADMIN:            'text-red-400 bg-red-500/20 border-red-500/30',
  FACTORY_ADMIN:          'text-purple-400 bg-purple-500/20 border-purple-500/30',
  PLANT_MANAGER:          'text-purple-400 bg-purple-500/20 border-purple-500/30',
  PRODUCTION_SUPERVISOR:  'text-blue-400 bg-blue-500/20 border-blue-500/30',
  SHIFT_SUPERVISOR:       'text-blue-400 bg-blue-500/20 border-blue-500/30',
  QUALITY_ENGINEER:       'text-green-400 bg-green-500/20 border-green-500/30',
  MAINTENANCE_TECHNICIAN: 'text-amber-400 bg-amber-500/20 border-amber-500/30',
  OPERATOR:               'text-cyan-400 bg-cyan-500/20 border-cyan-500/30',
};

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
}

const ROLE_FILTERS = ['All Roles', 'FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_SUPERVISOR', 'QUALITY_ENGINEER', 'MAINTENANCE_TECHNICIAN', 'OPERATOR'];

const ROLES = ['FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_SUPERVISOR', 'SHIFT_SUPERVISOR', 'QUALITY_ENGINEER', 'MAINTENANCE_TECHNICIAN', 'OPERATOR'];

export function UsersView() {
  const { t } = useTranslation('modules');
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('All Roles')
  const [formOpen, setFormOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null)
  const [form, setForm] = useState({
    name: '', email: '', role: 'OPERATOR', department: '', jobTitle: '', phone: '', password: '',
  })

  const [page, setPage] = useState(1)
  const PAGE_LIMIT = 20
  const { data, isLoading } = useQuery({
    queryKey: ['users', { search, role: roleFilter, page }],
    queryFn: () => api.get('/users', {
      params: {
        search: search || undefined,
        role: roleFilter === 'All Roles' ? undefined : roleFilter,
        page,
        limit: PAGE_LIMIT,
      },
    }),
    staleTime: 30_000,
  })
  useEffect(() => { setPage(1) }, [search, roleFilter])

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/users', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User created successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to create user', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/users/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User updated successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to update user', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User deleted successfully' })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to delete user', variant: 'destructive' }),
  })

  const users: User[] = (data as any)?.data ?? (data as any) ?? [];

  const handleOpenCreate = () => {
    setEditUser(null)
    setForm({ name: '', email: '', role: 'OPERATOR', department: '', jobTitle: '', phone: '', password: '' })
    setFormOpen(true)
  };

  const handleOpenEdit = (user: User) => {
    setEditUser(user)
    setForm({ name: user.name, email: user.email, role: user.role, department: user.department || '', jobTitle: '', phone: '', password: '' })
    setFormOpen(true)
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditUser(null)
  };

  const handleSubmit = () => {
    if (editUser) {
      updateMutation.mutate({ id: editUser.id, dto: form })
    } else {
      createMutation.mutate(form)
    }
  };

  const isValid = !!(form.name && form.email && form.role && (!editUser ? form.password.length >= 6 : true))

  const activeCount = users.filter(u => u.isActive).length;
  const deptSet = new Set(users.map(u => u.department).filter(Boolean))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('users.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('users.subtitle')}</p>
        </div>
        <Button size="sm" onClick={handleOpenCreate}>
          <UserPlus className="w-4 h-4 me-2" />
          {t('users.addUser')}
        </Button>
      </div>

      <InlineFormSlot />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('users.stat.totalUsers'),  value: users.length,     icon: Users,        color: 'text-brand-400' },
          { label: t('users.stat.active'),       value: activeCount,      icon: CheckCircle,  color: 'text-green-400' },
          { label: t('users.stat.inactive'),     value: users.length - activeCount, icon: XCircle, color: 'text-gray-400' },
          { label: t('users.stat.departments'),  value: deptSet.size,     icon: Users,        color: 'text-cyan-400'  },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="glass-card rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <Icon className={cn('w-4 h-4', stat.color)} />
              </div>
              <div>
                <div className="text-xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t('users.search')} className="ps-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {roleFilter === 'All Roles' ? t('users.allRoles') : roleFilter.replace(/_/g, ' ')}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {ROLE_FILTERS.map(r => (
              <DropdownMenuItem key={r} onClick={() => setRoleFilter(r)}>
                {r === 'All Roles' ? t('users.allRoles') : r.replace(/_/g, ' ')}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-start p-4 text-muted-foreground font-medium">{t('users.col.user')}</th>
              <th className="text-start p-4 text-muted-foreground font-medium">{t('users.col.role')}</th>
              <th className="text-start p-4 text-muted-foreground font-medium">{t('users.col.department')}</th>
              <th className="text-start p-4 text-muted-foreground font-medium">{t('users.col.factory')}</th>
              <th className="text-start p-4 text-muted-foreground font-medium">{t('users.col.status')}</th>
              <th className="text-start p-4 text-muted-foreground font-medium">{t('users.col.lastLogin')}</th>
              <th className="text-end p-4 text-muted-foreground font-medium">{t('users.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="p-4"><div className="shimmer h-4 rounded w-24" /></td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">{t('users.noUsers')}</td>
              </tr>
            ) : (
              users.map((user, i) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-border/50 hover:bg-foreground/5"
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-brand-600/30 text-brand-300 text-xs">
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />{user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge className={cn('text-[10px]', roleColors[user.role] ?? '')}>
                      {user.role.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="p-4 text-muted-foreground text-xs">{user.department ?? '—'}</td>
                  <td className="p-4 text-muted-foreground text-xs">{user.factory?.code ?? '—'}</td>
                  <td className="p-4">
                    <div className={cn('flex items-center gap-1.5 text-xs', user.isActive ? 'text-green-400' : 'text-gray-400')}>
                      {user.isActive ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {user.isActive ? t('users.active') : t('users.inactive')}
                    </div>
                  </td>
                  <td className="p-4 text-xs text-muted-foreground">
                    {user.lastLoginAt ? timeAgo(user.lastLoginAt) : t('users.never')}
                  </td>
                  <td className="p-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenEdit(user)}>
                          <Pencil className="w-3.5 h-3.5 me-2" />{t('users.editUser')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ id: user.id, name: user.name })}>
                          <Trash2 className="w-3.5 h-3.5 me-2" />{t('users.deleteUser')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
        {(((data as any)?.total ?? 0) > PAGE_LIMIT) && (
          <div className="border-t border-border/50 px-4 py-2">
            <TablePagination page={page} total={(data as any)?.total ?? 0} limit={PAGE_LIMIT} onPageChange={setPage} isLoading={isLoading} />
          </div>
        )}
      </div>

      <FormDialog
        open={formOpen}
        onClose={handleCloseForm}
        title={editUser ? t('users.form.editTitle') : t('users.form.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('users.form.name')} *</Label>
            <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('users.form.email')} *</Label>
            <Input type="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('users.form.role')} *</Label>
            <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('users.form.department')}</Label>
            <Input value={form.department} onChange={e => setForm(v => ({ ...v, department: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('users.form.jobTitle')}</Label>
            <Input value={form.jobTitle} onChange={e => setForm(v => ({ ...v, jobTitle: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('users.form.phone')}</Label>
            <Input value={form.phone} onChange={e => setForm(v => ({ ...v, phone: e.target.value }))} className="mt-1" />
          </div>
          {!editUser && (
            <div className="col-span-2">
              <Label>{t('users.form.password')} *</Label>
              <Input type="password" value={form.password} onChange={e => setForm(v => ({ ...v, password: e.target.value }))} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">{t('users.form.passwordHint')}</p>
            </div>
          )}
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('users.form.deleteTitle', { name: deleteDialog?.name })}
        description={t('users.form.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
