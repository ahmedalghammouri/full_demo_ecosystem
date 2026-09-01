'use client';

/**
 * Central react-i18next instance for the web app.
 *
 * Locale is NOT routed (no /en /ar URL prefixes). The source of truth is the
 * `locale` cookie (read by the server in app/layout.tsx to set <html lang dir>)
 * mirrored from `user.language`. See I18N-TECHNICAL-REFERENCE.md.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from '@/locales/en/common.json';
import arCommon from '@/locales/ar/common.json';
import enShell from '@/locales/en/shell.json';
import arShell from '@/locales/ar/shell.json';
import enSettings from '@/locales/en/settings.json';
import arSettings from '@/locales/ar/settings.json';
import enApps from '@/locales/en/apps.json';
import arApps from '@/locales/ar/apps.json';
import enDashboard from '@/locales/en/dashboard.json';
import arDashboard from '@/locales/ar/dashboard.json';
import enProduction from '@/locales/en/production.json';
import arProduction from '@/locales/ar/production.json';
import enQuality from '@/locales/en/quality.json';
import arQuality from '@/locales/ar/quality.json';
import enMaintenance from '@/locales/en/maintenance.json';
import arMaintenance from '@/locales/ar/maintenance.json';
import enInventory from '@/locales/en/inventory.json';
import arInventory from '@/locales/ar/inventory.json';
import enIot from '@/locales/en/iot.json';
import arIot from '@/locales/ar/iot.json';
import enModules from '@/locales/en/modules.json';
import arModules from '@/locales/ar/modules.json';
import enDowntime from '@/locales/en/downtime.json';
import arDowntime from '@/locales/ar/downtime.json';
import arNav from '@/locales/ar/nav.json';

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES: Locale[] = ['ar'];

export const dirOf = (l?: string): 'rtl' | 'ltr' => (RTL_LOCALES.includes(l as Locale) ? 'rtl' : 'ltr');
export const isSupported = (l?: string): l is Locale => SUPPORTED_LOCALES.includes(l as Locale);

export const NAMESPACES = ['common', 'shell', 'settings', 'apps', 'dashboard', 'production', 'quality', 'maintenance', 'inventory', 'iot', 'modules', 'downtime', 'nav'] as const;

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: {
        common: enCommon, shell: enShell, settings: enSettings, apps: enApps, dashboard: enDashboard, production: enProduction, quality: enQuality, maintenance: enMaintenance, inventory: enInventory, iot: enIot, modules: enModules, downtime: enDowntime,
        // 'nav' uses flat English-string keys; English IS the key → no en file needed.
        nav: {},
      },
      ar: {
        common: arCommon, shell: arShell, settings: arSettings, apps: arApps, dashboard: arDashboard, production: arProduction, quality: arQuality, maintenance: arMaintenance, inventory: arInventory, iot: arIot, modules: arModules, downtime: arDowntime, nav: arNav,
      },
    },
    lng: 'en',                 // overridden by LocaleProvider on mount
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: NAMESPACES as unknown as string[],
    interpolation: { escapeValue: false }, // React already escapes
    returnEmptyString: false,
    react: { useSuspense: false },
  });
}

export default i18n;
