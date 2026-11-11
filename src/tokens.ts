/** DI tokens. The domain classes carry no decorators, so Nest wires them through factory providers. */
export const TOKENS = {
  CONFIG: 'PQ_CONFIG',
  EVENTS: 'PQ_EVENTS',
  SERVICE: 'PQ_SERVICE',
  LIMITER: 'PQ_LIMITER',
  /** 'postgres' | 'file', reported by /health */
  STORE: 'PQ_STORE',
} as const;
