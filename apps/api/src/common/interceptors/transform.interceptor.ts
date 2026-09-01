import { Injectable, NestInterceptor, ExecutionContext, CallHandler, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  requestId?: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return next.handle().pipe(
      map((data) => {
        // A binary download is not an API payload. Wrapping a StreamableFile in
        // the JSON envelope serialises the object instead of piping the file, so
        // the client receives a few hundred bytes of `{"success":true,...}` with
        // the right filename on it — a corrupt archive that looks like a
        // successful download until somebody tries to restore from it.
        if (data instanceof StreamableFile) return data as never;

        return {
          success: true,
          data,
          timestamp: new Date().toISOString(),
          requestId: request.headers['x-request-id'],
        };
      }),
    );
  }
}
