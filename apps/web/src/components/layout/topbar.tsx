'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  LogOut,
  User,
  Settings,
  HelpCircle,
  Wifi,
  WifiOff,
  Activity,
  Globe,
  AlertTriangle,
  Map,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { useAuthStore } from '@/store/auth-store';
import { useFactoryStore } from '@/store/factory-store';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';
import { useLocale } from '@/lib/use-locale';
import { useWebSocketStatus } from '@/hooks/use-websocket';
import { useBreadcrumbStore } from '@/store/breadcrumb-store';
import { NotificationBell } from './notification-bell';

const breadcrumbLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  production: 'Production',
  orders: 'Work Orders',
  batches: 'Batches',
  oee: 'OEE Analytics',
  scheduling: 'Production Scheduling',
  recipes: 'Recipe Management',
  quality: 'Quality Management',
  inspections: 'Inspections',
  ncr: 'Non-Conformance Reports',
  capa: 'CAPA Management',
  spc: 'SPC Charts',
  maintenance: 'Maintenance',
  'work-orders': 'Maintenance Orders',
  assets: 'Assets',
  preventive: 'Preventive Maintenance',
  'spare-parts': 'Spare Parts',
  'spare-requests': 'Spare Part Requests',
  'raw-materials': 'Raw Materials',
  reports: 'Reports',
  iot: 'IIoT & Connectivity',
  devices: 'Devices',
  tags: 'Tag Browser',
  drivers: 'Drivers',
  hierarchy: 'Plant Hierarchy',
  traceability: 'Traceability',
  ai: 'AI Intelligence',
  bom: 'Bill of Materials',
  'storage-locations': 'Storage Locations',
  processes: 'Manufacturing Processes',
  notifications: 'Notifications',
  rules: 'Notification Rules',
  preferences: 'Preferences',
  users: 'Users & Roles',
  settings: 'Settings',
  'shop-floor': 'Shop Floor',
  live: 'Live Dashboard',
  'dashboard-center': 'Dashboard Center',
  'reschedule-requests': 'Reschedule Requests',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleCase(seg: string) {
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function Breadcrumb() {
  const { t } = useTranslation('shell');
  const pathname = usePathname();
  const router = useRouter();
  const dynamicLabels = useBreadcrumbStore((s) => s.labels);
  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav className="flex items-center gap-1.5 text-sm min-w-0">
      {segments.map((seg, i) => {
        // Resolve label: dynamic store (e.g. JO title) → static map → titlecase → "Details" for bare UUIDs
        const label =
          dynamicLabels[seg] ||
          (breadcrumbLabels[seg] ? t(`breadcrumbs.${seg}`, { defaultValue: breadcrumbLabels[seg] }) : undefined) ||
          (UUID_RE.test(seg) ? t('details') : titleCase(seg));
        const isLast = i === segments.length - 1;
        const href = '/' + segments.slice(0, i + 1).join('/');
        return (
          <React.Fragment key={`${seg}-${i}`}>
            {i > 0 && <span className="text-muted-foreground/40">/</span>}
            <span
              onClick={() => !isLast && router.push(href)}
              className={cn(
                'truncate max-w-[220px]',
                isLast
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground cursor-pointer transition-colors',
              )}
              title={label}
            >
              {label}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function ThemeSwitcher() {
  const { t } = useTranslation('common');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = [
    { value: 'light', icon: Sun, label: t('topbar.light') },
    { value: 'dark', icon: Moon, label: t('topbar.dark') },
    { value: 'system', icon: Monitor, label: t('topbar.system') },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          {!mounted ? <Monitor size={15} /> : theme === 'dark' ? <Moon size={15} /> : theme === 'light' ? <Sun size={15} /> : <Monitor size={15} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map(({ value, icon: Icon, label }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className={cn('gap-2', theme === value && 'text-primary')}
          >
            <Icon size={14} />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageSwitcher() {
  const { t, locale, setLocale } = useLocale();
  const { user, setUser } = useAuthStore();

  const choose = (lng: 'en' | 'ar') => {
    setLocale(lng);
    // Persist to the user profile (best-effort) so it follows the account.
    if (user && user.language !== lng) {
      setUser({ ...user, language: lng });
      api.patch('/users/me', { language: lng }).catch(() => {});
    }
  };

  const options: { value: 'en' | 'ar'; label: string }[] = [
    { value: 'en', label: t('english', { ns: 'shell' }) },
    { value: 'ar', label: t('arabic', { ns: 'shell' }) },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title={t('language', { ns: 'shell' })}>
          <Globe size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map(({ value, label }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => choose(value)}
            className={cn('gap-2 justify-between', locale === value && 'text-primary')}
          >
            {label}
            <span className="text-[10px] font-mono uppercase opacity-60">{value}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionStatus() {
  const isConnected = useWebSocketStatus();
  const { t } = useTranslation(['shell', 'common']);

  return (
    <div className={cn(
      'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
      isConnected
        ? 'bg-success-500/10 text-success-400'
        : 'bg-danger-500/10 text-danger-400',
    )}>
      {isConnected ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
          <span className="hidden sm:inline">{t('common:status.live')}</span>
        </>
      ) : (
        <>
          <WifiOff size={12} />
          <span className="hidden sm:inline">{t('offline')}</span>
        </>
      )}
    </div>
  );
}

function FactoryChip() {
  const { selectedFactory } = useFactoryStore();
  if (!selectedFactory) return null;
  return (
    <div
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
      style={{
        borderColor: `${selectedFactory.color}40`,
        background: `${selectedFactory.color}10`,
        color: selectedFactory.color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
        style={{ background: selectedFactory.color }}
      />
      <span className="font-mono tracking-wider">{selectedFactory.code}</span>
    </div>
  );
}

export function Topbar() {
  const { t } = useTranslation('shell');
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="h-14 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center px-4 gap-3 shrink-0 sticky top-0 z-40">
      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Factory indicator */}
        <FactoryChip />

        {/* Connection status */}
        <ConnectionStatus />

        {/* Search */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={15} />
        </Button>

        {/* Language */}
        <LanguageSwitcher />

        {/* Theme */}
        <ThemeSwitcher />

        {/* Notifications */}
        <NotificationBell />

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-1" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 h-8 rounded-lg px-2 hover:bg-muted/50 transition-colors">
              <Avatar className="w-6 h-6">
                <AvatarImage src={user?.avatarUrl} />
                <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-bold">
                  {user?.name?.substring(0, 2).toUpperCase() || 'US'}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:block max-w-[120px] truncate">
                {user?.name || t('topbar.user', { ns: 'common' })}
              </span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div>
                <div className="font-semibold">{user?.name}</div>
                <div className="text-xs text-muted-foreground font-normal">{user?.email}</div>
                <Badge variant="secondary" className="mt-1 text-[10px]">{user?.role}</Badge>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2">
              <User size={14} />
              {t('profile')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <Settings size={14} />
              {t('settings')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <Activity size={14} />
              {t('activityLog')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <HelpCircle size={14} />
              {t('help')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-destructive focus:text-destructive"
              onClick={() => { logout(); router.push('/'); }}
            >
              <LogOut size={14} />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
