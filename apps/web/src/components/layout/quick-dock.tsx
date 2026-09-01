'use client';
import { useTranslation } from 'react-i18next';

/**
 * QuickDock — a macOS-style magnifying dock of project-wide quick actions.
 *
 * Fixed to the bottom-centre of every page. A small handle toggles it open/closed;
 * it also closes on outside-click, Escape, or route change. Actions are grouped by
 * category with vertical separators, icons magnify based on cursor proximity, a
 * cursor-tracking label shows the hovered action, and left/right chevrons appear
 * when the row overflows on narrow screens.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { Rocket, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CORE_QUICK_ACTIONS, type QuickAction } from '@/lib/quick-actions';

const BASE = 42; // resting icon box size (px)
const MAX = 62; // magnified icon box size (px)
const RANGE = 120; // px of cursor distance over which magnification falls off

function DockIcon({
  action,
  mouseX,
  active,
  onHover,
}: {
  action: QuickAction;
  mouseX: MotionValue<number>;
  active: boolean;
  onHover: (label: string | null) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const Icon = action.icon;

  // Distance from cursor to this icon's centre (viewport coords → scroll-safe).
  const distance = useTransform(mouseX, (val) => {
    const b = ref.current?.getBoundingClientRect();
    if (!b) return RANGE + 1;
    return val - (b.x + b.width / 2);
  });

  const sizeSync = useTransform(distance, [-RANGE, 0, RANGE], [BASE, MAX, BASE], { clamp: true });
  const size = useSpring(sizeSync, { mass: 0.1, stiffness: 170, damping: 14 });
  const iconScale = useTransform(size, [BASE, MAX], [1, 1.4]);
  const lift = useTransform(size, [BASE, MAX], [0, -6]);

  return (
    <Link
      ref={ref}
      href={action.href}
      target={action.newTab ? '_blank' : undefined}
      rel={action.newTab ? 'noopener noreferrer' : undefined}
      aria-label={action.label}
      onMouseEnter={() => onHover(action.label)}
      onFocus={() => onHover(action.label)}
      className="flex shrink-0 items-center justify-center"
    >
      <motion.div
        style={{ width: size, height: size, y: lift }}
        className={cn(
          'relative flex items-center justify-center rounded-2xl border shadow-sm transition-colors',
          'bg-gradient-to-b from-card/80 to-card/50',
          active
            ? 'border-primary/60 ring-1 ring-primary/30'
            : 'border-white/10 hover:border-primary/40',
        )}
      >
        <motion.span style={{ scale: iconScale }} className="flex items-center justify-center">
          <Icon size={18} className={action.tone} />
        </motion.span>
        {active && <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-primary shadow shadow-primary/50" />}
      </motion.div>
    </Link>
  );
}

export function QuickDock() {
  const { t } = useTranslation('nav');
  const tn = (label: string) => t(label, { keySeparator: false, nsSeparator: false, defaultValue: label });
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const mouseX = useMotionValue(Infinity);
  const wrapRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Label x-position tracks the cursor, relative to the (non-clipped) dock shell.
  const labelX = useTransform(mouseX, (val) => {
    const b = shellRef.current?.getBoundingClientRect();
    return b ? val - b.left : 0;
  });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  const scrollByDir = (dir: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  };

  // Recompute scroll edges when opened / resized.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(updateEdges);
    window.addEventListener('resize', updateEdges);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', updateEdges);
    };
  }, [open, updateEdges]);

  // Close on outside-click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close after navigating to a new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div
      ref={wrapRef}
      className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      <AnimatePresence>
        {open && (
          <motion.div
            ref={shellRef}
            initial={{ opacity: 0, y: 26, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 26, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={cn(
              'relative flex h-[74px] max-w-[94vw] items-center rounded-[1.6rem] px-2',
              'border border-white/10 bg-gradient-to-b from-background/85 to-background/65',
              'shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)] ring-1 ring-black/5 backdrop-blur-2xl',
            )}
          >
            {/* Top sheen — macOS glass highlight */}
            <span className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

            {/* Edge fades signal more icons beyond the visible row */}
            {edges.left && <span className="pointer-events-none absolute inset-y-2 left-1 z-[5] w-12 rounded-l-[1.4rem] bg-gradient-to-r from-background/90 to-transparent" />}
            {edges.right && <span className="pointer-events-none absolute inset-y-2 right-1 z-[5] w-12 rounded-r-[1.4rem] bg-gradient-to-l from-background/90 to-transparent" />}

            {/* Cursor-tracking label */}
            <AnimatePresence>
              {hovered && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.9 }}
                  transition={{ duration: 0.12 }}
                  style={{ left: labelX }}
                  className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-popover/95 px-2.5 py-1 text-[11px] font-medium text-popover-foreground shadow-xl backdrop-blur"
                >
                  {tn(hovered)}
                  <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-white/10 bg-popover/95" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Left chevron */}
            <AnimatePresence>
              {edges.left && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => scrollByDir(-1)}
                  aria-label="Scroll left"
                  className="absolute left-1 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-background/80 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
                >
                  <ChevronLeft size={16} />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Scrolling row of grouped icons */}
            <div
              ref={scrollRef}
              onScroll={updateEdges}
              onMouseMove={(e) => mouseX.set(e.clientX)}
              onMouseLeave={() => {
                mouseX.set(Infinity);
                setHovered(null);
              }}
              className="no-scrollbar flex h-full items-center gap-1.5 overflow-x-auto overflow-y-hidden px-1"
            >
              {/* Core actions only — the full app catalogue lives on the Apps page. */}
              <div className="flex items-center gap-1.5">
                {CORE_QUICK_ACTIONS.map((a) => (
                  <DockIcon
                    key={a.href + a.label}
                    action={a}
                    mouseX={mouseX}
                    onHover={setHovered}
                    active={pathname === a.href || (a.href !== '/' && pathname.startsWith(a.href + '/'))}
                  />
                ))}
              </div>
            </div>

            {/* Right chevron */}
            <AnimatePresence>
              {edges.right && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => scrollByDir(1)}
                  aria-label="Scroll right"
                  className="absolute right-1 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-background/80 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
                >
                  <ChevronRight size={16} />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle handle — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Hide quick actions' : 'Show quick actions'}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md transition-all',
          open
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-white/10 bg-background/80 text-muted-foreground hover:border-primary/40 hover:text-foreground',
        )}
      >
        {open ? <X size={13} /> : <Rocket size={13} className="text-primary" />}
        <span>{open ? 'Close' : 'Quick Actions'}</span>
      </button>
    </div>
  );
}
