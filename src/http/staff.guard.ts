import { CanActivate, ExecutionContext, Inject, Injectable, createParamDecorator } from '@nestjs/common';
import { UnauthorizedError, resolveStaff, type AppConfig } from '../domain';
import { TOKENS } from '../tokens';

interface StaffRequest {
  headers: Record<string, string | string[] | undefined>;
  staffName?: string;
}

/**
 * Every route of the staff controller requires `X-Staff-Key`: the shared STAFF_API_KEY or one of STAFF_USERS. GET included: the data is
 * personal. The resolved name is kept on the request for the case history (see `@StaffName()`).
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(@Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<StaffRequest>();
    const name = resolveStaff(this.config, req.headers['x-staff-key']);
    if (!name) throw new UnauthorizedError();
    req.staffName = name;
    return true;
  }
}
