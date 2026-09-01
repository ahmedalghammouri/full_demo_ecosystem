import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GrafanaEmbedContext {
  factoryId?: string | null;
  factoryCode?: string | null;
  areaId?: string | null;
  lineId?: string | null;
  machineId?: string | null;
  shiftId?: string | null;
  productId?: string | null;
  batchId?: string | null;
  from?: string | null;
  to?: string | null;
  theme?: string | null;
  refresh?: string | null;
  kiosk?: boolean;
}

export interface GrafanaDashboardSummary {
  uid: string;
  title: string;
  url: string;
  slug: string;
  folderTitle?: string;
  folderUid?: string;
  tags: string[];
}

/**
 * Thin integration layer over Grafana.
 *
 * Responsibilities:
 *  - Build factory-aware embed URLs (kiosk mode) for the embedded viewer.
 *  - Query the Grafana HTTP API (search / health) using a service-account token.
 *
 * Industry360° stays the auth & factory-context provider; Grafana is the render engine.
 * Browser-facing embedding is expected to go through a reverse proxy that injects
 * the Grafana auth.proxy header (see docs/DASHBOARD_CENTER.md). This service never
 * leaks the service-account token to the browser.
 */
@Injectable()
export class GrafanaService {
  private readonly logger = new Logger(GrafanaService.name);

  constructor(private readonly config: ConfigService) {}

  /** Server-side base used for Grafana HTTP API calls (token-authenticated). */
  private get apiBase(): string | null {
    const url = this.config.get<string>('GRAFANA_URL');
    return url ? url.replace(/\/$/, '') : null;
  }

  /** Browser-facing base used to build iframe URLs (usually the proxied path). */
  private get publicBase(): string | null {
    const pub = this.config.get<string>('GRAFANA_PUBLIC_URL');
    if (pub) return pub.replace(/\/$/, '');
    return this.apiBase; // fall back to same origin
  }

  private get saToken(): string | null {
    return this.config.get<string>('GRAFANA_SA_TOKEN') ?? null;
  }

  private get defaultOrgId(): number {
    return parseInt(this.config.get<string>('GRAFANA_DEFAULT_ORG_ID', '1'), 10) || 1;
  }

  /** Name of the Grafana template variable that carries factory context. */
  private get factoryVar(): string {
    return this.config.get<string>('GRAFANA_FACTORY_VAR', 'factory');
  }

  isConfigured(): boolean {
    return !!this.apiBase || !!this.publicBase;
  }

  isApiEnabled(): boolean {
    return !!this.apiBase && !!this.saToken;
  }

  /**
   * Build a kiosk-mode embed URL for an iframe, injecting factory/ISA-95 context
   * as Grafana template variables (var-*) and the time range.
   */
  buildEmbedUrl(
    dashboard: {
      grafanaUid?: string | null;
      grafanaSlug?: string | null;
      grafanaOrgId?: number | null;
      defaultTimeRange?: string | null;
      refreshInterval?: string | null;
      isFactoryAware?: boolean;
      supportedScopes?: string[];
    },
    ctx: GrafanaEmbedContext = {},
  ): string | null {
    const base = this.publicBase;
    if (!base || !dashboard.grafanaUid) return null;

    const slug = dashboard.grafanaSlug || 'd';
    const params = new URLSearchParams();

    // Kiosk hides Grafana's own chrome so it blends into Industry360°.
    if (ctx.kiosk !== false) params.set('kiosk', '1');

    params.set('orgId', String(dashboard.grafanaOrgId ?? this.defaultOrgId));
    params.set('theme', ctx.theme === 'light' ? 'light' : 'dark');

    params.set('from', ctx.from || dashboard.defaultTimeRange || 'now-24h');
    if (ctx.to) params.set('to', ctx.to);
    else params.set('to', 'now');

    const refresh = ctx.refresh || dashboard.refreshInterval;
    if (refresh) params.set('refresh', refresh);

    // Factory + ISA-95 scope variables — only when the dashboard opts in.
    if (dashboard.isFactoryAware !== false) {
      const scopes = dashboard.supportedScopes ?? [];
      const allow = (s: string) => scopes.length === 0 || scopes.includes(s);

      if (allow('FACTORY') && (ctx.factoryCode || ctx.factoryId)) {
        params.set(`var-${this.factoryVar}`, ctx.factoryCode || ctx.factoryId!);
        if (ctx.factoryId) params.set('var-factoryId', ctx.factoryId);
      }
      if (allow('AREA') && ctx.areaId) params.set('var-area', ctx.areaId);
      if (allow('LINE') && ctx.lineId) params.set('var-line', ctx.lineId);
      if (allow('MACHINE') && ctx.machineId) params.set('var-machine', ctx.machineId);
      if (allow('SHIFT') && ctx.shiftId) params.set('var-shift', ctx.shiftId);
      if (allow('PRODUCT') && ctx.productId) params.set('var-product', ctx.productId);
      if (allow('BATCH') && ctx.batchId) params.set('var-batch', ctx.batchId);
    }

    return `${base}/d/${dashboard.grafanaUid}/${slug}?${params.toString()}`;
  }

  /** List Grafana dashboards via the HTTP API. Returns [] when not configured. */
  async searchDashboards(query?: string, tag?: string): Promise<GrafanaDashboardSummary[]> {
    if (!this.isApiEnabled()) return [];
    const params = new URLSearchParams({ type: 'dash-db', limit: '500' });
    if (query) params.set('query', query);
    if (tag) params.append('tag', tag);

    try {
      const res = await this.grafanaFetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        this.logger.warn(`Grafana search failed: ${res.status} ${res.statusText}`);
        return [];
      }
      const data = (await res.json()) as Array<Record<string, unknown>>;
      return data.map((d) => ({
        uid: String(d.uid ?? ''),
        title: String(d.title ?? ''),
        url: String(d.url ?? ''),
        slug: String(d.url ?? '').split('/').pop() || 'd',
        folderTitle: d.folderTitle ? String(d.folderTitle) : undefined,
        folderUid: d.folderUid ? String(d.folderUid) : undefined,
        tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
      }));
    } catch (err) {
      this.logger.warn(`Grafana search error: ${(err as Error).message}`);
      return [];
    }
  }

  async health(): Promise<{ configured: boolean; apiEnabled: boolean; reachable: boolean }> {
    const base = { configured: this.isConfigured(), apiEnabled: this.isApiEnabled(), reachable: false };
    if (!this.isApiEnabled()) return base;
    try {
      const res = await this.grafanaFetch('/api/health');
      return { ...base, reachable: res.ok };
    } catch {
      return base;
    }
  }

  private grafanaFetch(path: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    return fetch(`${this.apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${this.saToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  }
}
