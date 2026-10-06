import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { DomainError, type RateLimiter } from '../domain';
import { TOKENS } from '../tokens';

/** Stricter per-IP limit for the two anonymous write endpoints (preview and create), which cost an AI call each. */
@Injectable()
export class PublicWriteGuard implements CanActivate {
  constructor(@Inject(TOKENS.LIMITER) private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    if (!this.limiter.hit(req.ip ?? 'unknown')) throw new DomainError(429, 'TOO_MANY_REQUESTS', 'Demasiadas solicitudes desde tu conexión. Espera un minuto e intenta de nuevo.');
    return true;
  }
}
