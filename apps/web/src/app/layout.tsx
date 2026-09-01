import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import { Providers } from '@/components/providers';
import './globals.css';

// Arabic-capable font (Geist has weak Arabic coverage). Loaded at RUNTIME via a
// <link> to Google Fonts (see <head> below) instead of next/font/google, so the
// production build never needs network access. --font-arabic + the Tajawal/Cairo
// fallbacks are defined in globals.css, so Arabic still renders cleanly offline.

const dirOf = (l?: string): 'rtl' | 'ltr' => (l === 'ar' ? 'rtl' : 'ltr');

export const metadata: Metadata = {
  title: {
    default: 'i360 Platform',
    template: '%s | i360',
  },
  description:
    'Enterprise Manufacturing Execution System — Real-time production monitoring, quality management, maintenance, and industrial IoT integration.',
  keywords: ['MES', 'Manufacturing', 'OEE', 'Production', 'Quality', 'Maintenance', 'IIoT', 'SCADA'],
  authors: [{ name: 'Industry360°', url: 'https://industry360.sa' }],
  creator: 'Industry360°',
  publisher: 'Industry360°',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/icon-192x192.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://mes.industry360.sa',
    title: 'i360 Platform',
    description: 'Enterprise Manufacturing Execution System',
    siteName: 'Industry360°',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7ff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e17' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = (await cookies()).get('locale')?.value ?? 'en';
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        {/* Arabic webfont at runtime (build stays offline). Falls back to Tajawal/Cairo/system. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
