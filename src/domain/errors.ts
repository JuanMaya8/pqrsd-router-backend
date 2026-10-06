/** Errors the HTTP layer turns into `{ statusCode, code, message }` (see docs/CONTRACT.md). Messages are Spanish. */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(details: string[]) {
    super(400, 'VALIDATION_ERROR', details.length === 1 ? details[0] : `Datos inválidos: ${details.slice(0, 5).join('; ')}`, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super(404, 'NOT_FOUND', `No existe ${what} «${id}».`);
    this.name = 'NotFoundError';
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, action: string) {
    super(409, 'INVALID_TRANSITION', `No se puede «${action}» una PQRSD en estado «${from}».`);
    this.name = 'InvalidTransitionError';
  }
}

export class AiUnavailableError extends DomainError {
  constructor(reason?: string) {
    super(503, 'AI_UNAVAILABLE', 'El servicio de IA no está disponible.' + (reason ? ` (${reason})` : ''));
    this.name = 'AiUnavailableError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Falta o es incorrecta la cabecera X-Staff-Key.');
    this.name = 'UnauthorizedError';
  }
}
