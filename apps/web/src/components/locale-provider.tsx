'use client';

import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n, { dirOf, isSupported, type Locale } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth-store';

function readCookieLocale(): Locale | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(/(?:^|;\s*)locale=(\w+)/);
  return m && isSupported(m[1]) ? (m[1] as Locale) : undefined;
}

function apply(locale: Locale) {
  if (i18n.language !== locale) i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dirOf(locale);
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Wires i18next to the app. Resolves the active locale in priority order:
 *   user.language (persisted preference) → `locale` cookie → 'en'
 * and keeps <html lang/dir> + the cookie in sync whenever the user's language
 * preference changes. Mount inside Providers (see components/providers.tsx).
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const userLang = useAuthStore((s) => s.user?.language);

  useEffect(() => {
    const resolved: Locale = (isSupported(userLang) ? userLang : undefined) ?? readCookieLocale() ?? 'en';
    apply(resolved);
  }, [userLang]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
