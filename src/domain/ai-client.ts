import { AiUnavailableError, DomainError } from './errors';
import type { Entity, PqrsdType, Subtype, TaxonomyDto, Urgency } from './types';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Snake-case payload of pqrsd-router-ai (see docs/CONTRACT.md §3). */
export interface AiChoice { id: string; label: string; confidence: number; alternatives?: Array<{ id: string; label: string; confidence: number }>; reasons?: string[] }
export interface AiClassification {
  type: AiChoice & { id: PqrsdType };
  dependency: AiChoice & { routed_to_fallback: boolean };
  urgency: AiChoice & { id: Urgency; priority_score: number };
  subtype: { id: Subtype; label: string; confidence: number; reasons?: string[] } | null;
  entities: Entity[];
  needs_review: boolean;
  review_reasons: string[];
  model_version: string;
}
export interface AiBatchResponse { results: Array<{ id: string | null; classification: AiClassification }>; total: number; needs_review: number; latency_ms: number }
export interface AiFeedback { text: string; type?: PqrsdType; dependency?: string; urgency?: Urgency; subtype?: Subtype; source_id?: string }
export interface AiModelInfo { model_version: string; trained_at: number | null; trained_on: Record<string, number>; metrics: Record<string, Record<string, number>>; heads: string[]; synthetic_samples: number; feedback_samples: number; note: string }
export interface AiFeedbackStats { total: number; by_head: Record<string, number>; since_last_training: number }

export interface AiClientOptions { baseUrl: string; apiKey?: string; timeoutMs?: number; fetchImpl?: FetchLike }

/**
 * HTTP client for pqrsd-router-ai. Network errors, timeouts and 5xx become AiUnavailableError (503 AI_UNAVAILABLE);
 * callers on the citizen path catch it and use the fallback classifier. 4xx errors keep their own code/message.
 */
export class AiClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: AiClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.opts.apiKey) headers['X-API-Key'] = this.opts.apiKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new AiUnavailableError(ctrl.signal.aborted ? 'tiempo de espera agotado' : e instanceof Error ? e.message : undefined);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500) throw new AiUnavailableError(`HTTP ${res.status}`);
    if (!res.ok) {
      let code = `AI_HTTP_${res.status}`;
      let message = `La IA respondió ${res.status}.`;
      try {
        const err = (await res.json()) as { code?: string; message?: string; detail?: unknown };
        if (err.code) code = err.code;
        if (err.message) message = err.message;
        else if (Array.isArray(err.detail)) message = 'Datos rechazados por la IA: ' + err.detail.slice(0, 3).map((d) => (d as { msg?: string }).msg ?? '').filter(Boolean).join('; ');
      } catch {
        /* not JSON */
      }
      // a 401/403 from the AI is a configuration problem of OUR server, not of the caller
      if (res.status === 401 || res.status === 403) throw new AiUnavailableError('la IA rechazó la clave del backend');
      throw new DomainError(res.status === 409 ? 409 : 422, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<{ status: string; model_version?: string; ready?: boolean }> {
    return this.call('GET', '/health', undefined, 3000);
  }
  classify(text: string, referenceDate: string): Promise<AiClassification> {
    return this.call('POST', '/v1/classify', { text, reference_date: referenceDate, top_k: 3 });
  }
  classifyBatch(items: Array<{ id?: string; text: string }>, referenceDate: string): Promise<AiBatchResponse> {
    return this.call('POST', '/v1/classify/batch', { items, reference_date: referenceDate, top_k: 3 }, Math.max(this.timeoutMs, 60_000));
  }
  taxonomy(): Promise<{ types: TaxonomyDto['types']; urgency: TaxonomyDto['urgency']; subtypes: TaxonomyDto['subtypes']; dependencies: TaxonomyDto['dependencies']; fallback_dependency: string }> {
    return this.call('GET', '/v1/taxonomy');
  }
  feedback(body: AiFeedback): Promise<{ stored: boolean; total_feedback: number }> {
    return this.call('POST', '/v1/feedback', body);
  }
  feedbackStats(): Promise<AiFeedbackStats> {
    return this.call('GET', '/v1/feedback/stats');
  }
  model(): Promise<AiModelInfo> {
    return this.call('GET', '/v1/model');
  }
  retrain(): Promise<AiModelInfo> {
    return this.call('POST', '/v1/retrain', { include_feedback: true }, 5 * 60_000);
  }
}
