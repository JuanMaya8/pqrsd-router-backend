import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedError, type AppConfig } from '../domain';
import { TOKENS } from '../tokens';

export function staffKeyMatches(expected: string | undefined, sent: unknown): boolean {
  if (!expected) return true; // development mode (main.ts refuses to boot in production without a key)
  const a = Buffer.from(typeof sent === 'string' ? sent : '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every route of the staff controller requires `X-Staff-Key` (when STAFF_API_KEY is set). GET included: the data is personal. */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(@Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    if (!staffKeyMatches(this.config.staffKey, req.headers['x-staff-key'])) throw new UnauthorizedError();
    return true;
  }
}
