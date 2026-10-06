export interface AppConfig {
  port: number;
  nodeEnv: string;
  staffKey?: string;
  aiUrl: string;
  aiApiKey?: string;
  aiTimeoutMs: number;
  dataDir: string;
  corsOrigins: string[];
  bodyLimitMb: number;
  throttleLimit: number;
  /** stricter per-minute limit for the two public write endpoints (preview and create) */
  publicWriteLimit: number;
  denunciaDays: number;
  /** 0 = off. When > 0, AI results with min(type, dependency) confidence ≥ this and no review flag skip manual triage. */
  autoAssignMinConfidence: number;
  feedbackOnConfirm: boolean;
  /** Express «trust proxy» hops (set 1 behind one reverse proxy so rate limiting sees the real client IP) */
  trustProxy: number;
  version: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const num = (v: string | undefined, d: number, min = 0): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? n : d;
  };
  return {
    port: num(env.PORT, 3001, 1),
    nodeEnv: env.NODE_ENV || 'development',
    staffKey: env.STAFF_API_KEY || undefined,
    aiUrl: env.AI_URL || 'http://localhost:8000',
    aiApiKey: env.AI_API_KEY || undefined,
    aiTimeoutMs: num(env.AI_TIMEOUT_MS, 8000, 1),
    dataDir: env.DATA_DIR || './data',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimitMb: num(env.BODY_LIMIT_MB, 5, 1),
    throttleLimit: num(env.THROTTLE_LIMIT, 300, 1),
    publicWriteLimit: num(env.PUBLIC_WRITE_LIMIT, 20, 1),
    denunciaDays: Math.round(num(env.DENUNCIA_DAYS, 15, 1)),
    autoAssignMinConfidence: num(env.AUTO_ASSIGN_MIN_CONFIDENCE, 0),
    feedbackOnConfirm: env.FEEDBACK_ON_CONFIRM === 'true',
    trustProxy: Math.round(num(env.TRUST_PROXY, 0)),
    version: env.npm_package_version ?? '0.1.0',
  };
}
