import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { AUDIT_LOG_KEY } from '../decorators/audit-log.decorator';

/** Request body keys whose values must never be written to the audit trail. */
const SENSITIVE_KEYS = /password|token|secret|authorization|apiKey|refreshToken/i;

/**
 * Persists an audit trail row to `audit_logs` for every handler annotated with
 * `@AuditLog(action)`. Registered via APP_INTERCEPTOR so Nest injects the
 * Reflector and PrismaService (a manually `new`-ed global interceptor gets
 * neither — which is why this never recorded anything before).
 *
 * Writes are fire-and-forget: a failed insert is logged but never breaks the
 * request it is auditing.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDIT_LOG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!action) return next.handle();

    const request = context.switchToHttp().getRequest<{
      user?: { id?: string; email?: string; factoryId?: string };
      ip?: string;
      method: string;
      originalUrl?: string;
      url: string;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    // Module derived from the controller class name (e.g. ProductionController → "production").
    const module = context.getClass().name.replace(/Controller$/, '').toLowerCase();
    const user = request.user;
    const method = request.method;
    const url = request.originalUrl ?? request.url;
    const startTime = Date.now();

    return next.handle().pipe(
      tap((result) => {
        const durationMs = Date.now() - startTime;
        const entityId =
          request.params?.id ??
          (result && typeof result === 'object' && 'id' in (result as object)
            ? String((result as { id: unknown }).id)
            : null);
        const newValues = method === 'GET' ? null : sanitize(request.body);

        this.prisma.auditLog
          .create({
            data: {
              factoryId: user?.factoryId ?? null,
              userId: user?.id ?? null,
              action,
              module,
              entityType: module,
              entityId,
              oldValues: undefined,
              newValues: (newValues ?? undefined) as Prisma.InputJsonValue | undefined,
              ipAddress: request.ip ?? null,
              userAgent: headerStr(request.headers?.['user-agent']),
              metadata: { method, url, durationMs } as Prisma.InputJsonValue,
            },
          })
          .catch((err) =>
            this.logger.warn(`Failed to persist audit log for ${action}: ${err?.message ?? err}`),
          );
      }),
    );
  }
}

/** Strips sensitive fields from a request body before it is persisted. */
function sanitize(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : v;
  }
  return out;
}

function headerStr(h: string | string[] | undefined): string | null {
  if (Array.isArray(h)) return h.join(', ');
  return h ?? null;
}
