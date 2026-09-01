/**
 * Shared CORS origin policy for the HTTP API and the WebSocket gateway.
 *
 * The app is single-origin behind nginx (which proxies /api/ and /socket.io/),
 * so reflecting an allowed request origin is safe here. We allow:
 *   - no origin (same-origin / server-to-server / curl)
 *   - localhost + private LAN ranges (10/8, 172.16/12, 192.168/16) so the app
 *     can be opened by IP from phones/tablets on the factory network
 *   - the whole industry360 / industry360 domain family (any subdomain, http/https,
 *     any port) so platform/poc/app.industry360.com (.sa) and demo.industry360.sa
 *     work without per-host config churn
 *   - anything explicitly listed in the CORS_ORIGINS env var
 */
export const LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export const PUBLIC_ORIGIN =
  /^https?:\/\/([a-z0-9-]+\.)*(industry360|industry360)\.(com|sa)(:\d+)?$/i;

/** Parse the comma-separated CORS_ORIGINS env var into a trimmed list. */
export function getCorsOrigins(raw?: string): string[] {
  return (raw ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** True if the given request origin is permitted by the policy above. */
export function isOriginAllowed(origin: string | undefined, allowList: string[]): boolean {
  return (
    !origin ||
    LAN_ORIGIN.test(origin) ||
    PUBLIC_ORIGIN.test(origin) ||
    allowList.includes(origin)
  );
}

/**
 * CORS `origin` callback compatible with both the `cors` package (used by
 * Express via app.enableCors) and socket.io's cors option.
 */
export function corsOriginCallback(allowList: string[]) {
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (isOriginAllowed(origin, allowList)) callback(null, true);
    else callback(new Error(`CORS: origin ${origin ?? '(none)'} not allowed`));
  };
}
