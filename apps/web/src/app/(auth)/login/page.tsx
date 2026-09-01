'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Loader2, Shield, AlertCircle, ArrowLeft, MapPin } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useAuthStore } from '@/store/auth-store';
import { useFactoryStore, type FactoryBrief } from '@/store/factory-store';
import { authService, type FactoriesOverview } from '@/services/auth.service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

// useSearchParams() requires a Suspense boundary for static prerender
export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const factoryCode = searchParams.get('factory');

  const { setAuth } = useAuthStore();
  const { setFactory, allFactories } = useFactoryStore();

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<FactoriesOverview | null>(null);

  // Live platform stats for the marketing panel (real, not hardcoded)
  useEffect(() => {
    authService.getFactoriesOverview().then(setOverview).catch(() => {});
  }, []);

  /**
   * A percentage that was never measured renders as an em-dash, not as 0.0%.
   *
   * The tiles read "Overall OEE 0.0%" for a running plant because the endpoint
   * coerced a missing measurement to zero. The API returns null now, and this
   * is the last place that could undo it -- `(null).toFixed` would have thrown,
   * so the type change alone forces the decision to be made here rather than
   * silently defaulted somewhere.
   */
  const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);

  // Stats reflect the selected factory's live KPIs, or the network summary
  const liveStats = (() => {
    if (!overview) return null;
    const f = factoryCode ? overview.factories.find((x) => x.code === factoryCode) : null;
    // The window is named on the label. A bare percentage invites the reader to
    // assume it means "right now", which is the one thing it does not mean.
    const w = `${overview.windowDays}d`;
    if (f) {
      return [
        { label: `Overall OEE · ${w}`, value: pct(f.kpis.oee) },
        { label: `Quality Rate · ${w}`, value: pct(f.kpis.quality) },
        // Not nullable: an alarm count of zero is a real, measured zero.
        { label: 'Active Alarms', value: `${f.kpis.activeAlarms}` },
      ];
    }
    return [
      { label: `Network Avg OEE · ${w}`, value: pct(overview.summary.avgOEE) },
      { label: 'Active Factories', value: `${overview.summary.totalFactories}` },
      { label: `Avg Quality · ${w}`, value: pct(overview.summary.avgQuality) },
    ];
  })();

  // Resolve factory info: store first (set by the selector), else the live overview fetch
  const factory: FactoryBrief | null = factoryCode
    ? (allFactories.find((f) => f.code === factoryCode) ??
        (() => {
          const f = overview?.factories.find((x) => x.code === factoryCode);
          if (!f) return null;
          return {
            id: f.id, code: f.code, name: f.name, nameAr: f.nameAr,
            city: f.city ?? undefined, lat: f.lat ?? undefined, lng: f.lng ?? undefined,
            color: f.color, glowColor: f.glowColor, isActive: f.isActive,
          };
        })())
    : null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rememberMe: false },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError(null);
    try {
      // Pass factoryCode so backend JWT includes factoryId
      const result = await authService.login(data.email, data.password, factoryCode ?? undefined);
      setAuth(result.user, result.accessToken, result.refreshToken);

      // Set factory context from the logged-in user's factory data
      const userFactory = result.user.factory;
      if (userFactory) {
        setFactory({
          id: userFactory.id,
          code: userFactory.code,
          name: userFactory.name,
          nameAr: userFactory.nameAr,
          city: undefined,
          lat: userFactory.lat,
          lng: userFactory.lng,
          color: userFactory.color,
          glowColor: userFactory.glowColor,
          isActive: true,
        });
      } else if (factory) {
        // SUPER_ADMIN logging in with a factory context
        setFactory(factory);
      }

      // Root resolves the landing: factory default live view if set, else /apps.
      router.push('/');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Invalid credentials. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-stretch">
      {/* Left — Industrial Background */}
      <div className="hidden lg:flex lg:flex-1 relative overflow-hidden bg-gradient-to-br from-[#05100d] via-[#04120f] to-[#030a08]">
        <div className="absolute inset-0 industrial-grid opacity-20" />
        <div className="absolute inset-0 bg-gradient-radial from-primary/10 via-transparent to-transparent" />

        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-accent/5 blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

        <div className="relative z-10 flex flex-col justify-between p-16">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-300 to-accent-500 flex items-center justify-center font-black text-[13px] tracking-tight text-brand-800">
              360°
            </div>
            <div>
              <div className="font-bold text-xl tracking-tight"><span className="text-white">Industry</span><span style={{ color: '#D9BB75' }}>360°</span></div>
              <div className="text-primary/70 text-xs font-medium tracking-widest uppercase">Manufacturing Execution</div>
            </div>
          </div>

          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="text-5xl font-bold text-white leading-tight">
                Smart Manufacturing
                <br />
                <span className="gradient-text">Execution System</span>
              </h1>
              <p className="mt-6 text-lg text-white/50 max-w-lg leading-relaxed">
                Real-time production monitoring, quality management, predictive maintenance, and industrial IoT — unified in one enterprise platform.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="grid grid-cols-3 gap-6"
            >
              {(liveStats ?? [
                { label: 'Network Avg OEE', value: '—' },
                { label: 'Active Factories', value: '—' },
                { label: 'Avg Quality', value: '—' },
              ]).map((stat) => (
                <div key={stat.label} className="glass-card rounded-xl p-4">
                  <div className="text-2xl font-bold gradient-text">{stat.value}</div>
                  <div className="text-xs text-white/40 mt-1">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </div>

          <div className="text-white/20 text-sm">
            © 2026 Industry360° — Enterprise Manufacturing Platform for Saudi Arabia
          </div>
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="flex-1 lg:max-w-lg flex items-center justify-center p-8 bg-background">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm space-y-8"
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-300 to-accent-500 flex items-center justify-center font-black text-[12px] tracking-tight text-brand-800">
              360°
            </div>
            <div className="font-bold text-lg"><span>Industry</span><span style={{ color: '#B08E42' }}>360°</span></div>
          </div>

          {/* Factory context badge */}
          {factory ? (
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3 border"
              style={{ borderColor: `${factory.color}40`, background: `${factory.color}08` }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: factory.color, boxShadow: `0 0 8px ${factory.color}` }}
                />
                <div>
                  <div className="text-xs font-bold font-mono" style={{ color: factory.color }}>
                    {factory.code}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight">{factory.name}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {factory.city && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin size={10} />
                    <span>{factory.city}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-2"
                >
                  <ArrowLeft size={12} />
                  Change
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={14} />
              Back to factory selection
            </button>
          )}

          <div>
            <h2 className="text-2xl font-bold text-foreground">
              {factory ? `Sign in to ${factory.code}` : 'Welcome back'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {factory
                ? `Access the MES platform for ${factory.name}`
                : 'Sign in to your MES account to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder={factory ? `you@${factory.code.toLowerCase()}.com.sa` : 'you@company.com'}
                autoComplete="email"
                className="h-11"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="h-11 pr-11"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="rememberMe" {...register('rememberMe')} />
              <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
                Remember me for 30 days
              </Label>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" className="w-full h-11 font-semibold" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in to MES'
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-3 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button variant="outline" className="w-full h-11 gap-2" type="button">
            <Shield className="w-4 h-4" />
            Single Sign-On (SSO)
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Protected by enterprise-grade security.
            <br />
            All activity is logged and audited.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
