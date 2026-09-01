'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible]   = useState(false);
  const timers  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevRef = useRef(pathname);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  /* Start the bar on same-origin link click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      try {
        const dest = new URL(anchor.href, location.href);
        if (dest.origin !== location.origin) return;
        if (dest.pathname === location.pathname) return;
      } catch { return; }

      clearTimers();
      setVisible(true);
      setProgress(8);

      const t1 = setTimeout(() => setProgress(32), 200);
      const t2 = setTimeout(() => setProgress(54), 500);
      const t3 = setTimeout(() => setProgress(72), 900);
      const t4 = setTimeout(() => setProgress(84), 1500);
      timers.current = [t1, t2, t3, t4];
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  /* Complete on pathname change */
  useEffect(() => {
    if (pathname === prevRef.current) return;
    prevRef.current = pathname;

    clearTimers();
    setProgress(100);

    const t = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 420);
    timers.current = [t];
  }, [pathname]);

  if (!visible && progress === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[10000] pointer-events-none"
      aria-hidden
    >
      {/* Main bar */}
      <div
        className="h-[2px] transition-all ease-out"
        style={{
          width: `${progress}%`,
          transitionDuration: progress === 100 ? '300ms' : '600ms',
          background: 'linear-gradient(90deg, #003933 0%, #d9bb75 50%, #4c7571 100%)',
          boxShadow:
            '0 0 8px rgba(0,57,51,0.8),' +
            '0 0 20px rgba(0,57,51,0.4)',
          opacity: visible ? 1 : 0,
          transitionProperty: progress === 100 ? 'width, opacity' : 'width',
        }}
      >
        {/* Shimmer spark */}
        <div
          className="absolute right-0 top-0 h-full w-16 pointer-events-none overflow-hidden"
          style={{
            background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)',
            animation: progress > 0 && progress < 100
              ? 'nav-bar-shimmer 1.1s ease-in-out infinite'
              : 'none',
          }}
        />
      </div>

      {/* Glowing tip dot */}
      {progress > 0 && progress < 100 && (
        <div
          className="absolute top-0 h-[2px] w-6 pointer-events-none"
          style={{
            right: `${100 - progress}%`,
            background: 'rgba(255,255,255,0.9)',
            boxShadow: '0 0 10px 2px rgba(167,139,250,1)',
            filter: 'blur(0.5px)',
          }}
        />
      )}
    </div>
  );
}
