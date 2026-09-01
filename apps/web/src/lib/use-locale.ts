'use client';

import { useTranslation } from 'react-i18next';
import i18n, { dirOf, type Locale } from '@/lib/i18n';

/**
 * Change the active UI language everywhere at once:
 *  - i18next (string translations)
 *  - <html lang> + <html dir>  (RTL/LTR)
 *  - the `locale` cookie (so the server renders the correct dir on next load)
 *
 * ALWAYS go through this helper — never call i18n.changeLanguage() alone, or the
 * three will drift. Persisting to the user profile is the caller's job (Settings).
 */
export function setLocale(locale: Locale) {
  if (i18n.language !== locale) i18n.changeLanguage(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
    document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  }
}

/** Convenience hook: t(), current locale, and isRtl — for components that need direction. */
export function useLocale() {
  const { t, i18n: inst } = useTranslation();
  const locale = (inst.language as Locale) || 'en';
  return { t, locale, isRtl: dirOf(locale) === 'rtl', setLocale };
}
