'use client';

import React, { useState } from 'react';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LocaleProvider } from '@/components/locale-provider';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (failureCount, error: unknown) => {
          const status = (error as { response?: { status: number } })?.response?.status;
          if (status === 401 || status === 403 || status === 404) return false;
          // 429 means we are ALREADY sending too much. Retrying is the one response
          // guaranteed to make it worse: each retry multiplies the offending query
          // by three and pushes other queries over the limit too. Back off instead —
          // the refetchInterval will pick the data up on the next cycle.
          if (status === 429) return false;
          return failureCount < 2;
        },
        // Bounded exponential backoff so a transient upstream blip does not produce
        // three near-simultaneous retries.
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
        // Live-by-default: render cached data instantly, then revalidate in the
        // background on mount AND on window focus. `'always'` ignores staleTime so
        // navigating (back) to a page always reflects the latest server state —
        // fixes "the table/button only updates after a manual refresh".
        refetchOnWindowFocus: true,
        refetchOnMount: 'always',
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // useState ensures a new QueryClient is not created on every render
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange={false}
        themes={['light', 'dark', 'system']}
      >
        <AuthProvider>
          <LocaleProvider>
            {children}
            <Toaster />
          </LocaleProvider>
        </AuthProvider>
      </ThemeProvider>
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  );
}
