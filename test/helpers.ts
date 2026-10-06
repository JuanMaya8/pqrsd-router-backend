import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AiClient, BlobPqrsdRepository, ClassificationService, EventBus, FakeClock, FileBlobStore, MemoryBlobStore, PqrsdService, TaxonomyProvider,
  DEFAULT_TAXONOMY, DEFAULT_DEADLINE_CONFIG,
  type AiClassification, type BlobStore, type FetchLike, type Entity, type PqrsdRepository,
} from '../src/domain';

function reply(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
}

/** In-memory fake of pqrsd-router-ai speaking the same contract (docs/CONTRACT.md §3). */
export class FakeAi {
  calls: Array<{ method: string; path: string; body?: any }> = [];
  down = false;
  feedback: any[] = [];
  retrains = 0;
  /** 1-based index of the /v1/classify/batch call that fails with a network error */
  failBatchAt: number | null = null;
  private batchCalls = 0;
  override: ((text: string) => Partial<AiClassification> | undefined) | null = null;

  classification(text: string): AiClassification {
    const t = text.toLowerCase();
    let type: AiClassification['type']['id'] = 'peticion';
    let dep = 'atencion_ciudadano';
    let urgency: AiClassification['urgency']['id'] = 'medium';
    let subtype: AiClassification['subtype'] = { id: 'general', label: 'Petición general', confidence: 0.7 };
    if (t.includes('denuncio')) { type = 'denuncia'; dep = 'control_interno'; subtype = null; }
    else if (t.includes('agua')) { type = 'reclamo'; dep = 'servicios_publicos'; subtype = null; }
    else if (t.includes('hueco')) { type = 'reclamo'; dep = 'infraestructura'; subtype = null; }
    else if (t.includes('copia')) { subtype = { id: 'information', label: 'Solicitud de información o documentos', confidence: 0.8 }; dep = 'planeacion'; }
    if (t.includes('gas')) urgency = 'critical';
    if (t.includes('sugiero')) { type = 'sugerencia'; urgency = 'low'; subtype = null; }
    const entities: Entity[] = [];
    const m = /cédula (\d[\d.]*\d)/i.exec(text);
    if (m) entities.push({ type: 'document_id', label: 'Documento', text: m[0], start: m.index, end: m.index + m[0].length, value: m[1], pii: true, approx: false });
    const base: AiClassification = {
      type: { id: type, label: type, confidence: 0.8, reasons: [`razón tipo ${type}`] },
      dependency: { id: dep, label: dep, confidence: 0.85, routed_to_fallback: false, reasons: [`razón dependencia ${dep}`] },
      urgency: { id: urgency, label: urgency, confidence: 0.7, priority_score: { critical: 90, high: 72, medium: 42, low: 15 }[urgency], reasons: [`razón urgencia ${urgency}`] },
      subtype,
      entities,
      needs_review: t.includes('dudoso'),
      review_reasons: t.includes('dudoso') ? ['La IA no está segura.'] : [],
      model_version: 'fake-1',
    };
    return { ...base, ...(this.override?.(text) ?? {}) } as AiClassification;
  }

  fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    this.calls.push({ method: init.method, path, body });
    if (this.down) throw new TypeError('fetch failed');
    if (path === '/health') return reply(200, { status: 'ok', version: 'x', model_version: 'fake-1', ready: true });
    if (path === '/v1/classify') return reply(200, this.classification(body.text));
    if (path === '/v1/classify/batch') {
      this.batchCalls += 1;
      if (this.failBatchAt === this.batchCalls) throw new TypeError('fetch failed');
      if (body.items.length > 200) return reply(422, { detail: [{ msg: 'too many' }] });
      return reply(200, { results: body.items.map((i: any) => ({ id: i.id ?? null, classification: this.classification(i.text) })), total: body.items.length, needs_review: 0, latency_ms: 1 });
    }
    if (path === '/v1/taxonomy') return reply(200, { types: DEFAULT_TAXONOMY.types, urgency: DEFAULT_TAXONOMY.urgency, subtypes: DEFAULT_TAXONOMY.subtypes, dependencies: DEFAULT_TAXONOMY.dependencies, fallback_dependency: 'atencion_ciudadano' });
    if (path === '/v1/feedback' && init.method === 'POST') {
      this.feedback.push(body);
      return reply(201, { stored: true, total_feedback: this.feedback.length });
    }
    if (path === '/v1/feedback/stats') return reply(200, { total: this.feedback.length, by_head: {}, since_last_training: this.feedback.length });
    if (path === '/v1/model') return reply(200, { model_version: 'fake-1', trained_at: 1, trained_on: {}, metrics: {}, heads: [], synthetic_samples: 6000, feedback_samples: this.feedback.length, note: 'SINTÉTICO' });
    if (path === '/v1/retrain') {
      this.retrains += 1;
      return reply(200, { model_version: 'fake-2', trained_at: 2, trained_on: {}, metrics: {}, heads: [], synthetic_samples: 6000, feedback_samples: this.feedback.length, note: 'SINTÉTICO' });
    }
    return reply(404, { code: 'NOT_FOUND', message: 'ruta' });
  };

  count(path: string): number {
    return this.calls.filter((c) => c.path === path).length;
  }
}

export interface Harness {
  ai: FakeAi;
  clock: FakeClock;
  events: Array<{ event: string; payload: any }>;
  service: PqrsdService;
  repo: PqrsdRepository;
  store: BlobStore;
  cleanup(): void;
}

/** Wednesday 2025-03-05 10:00 Bogotá (15:00Z). */
export const T0 = '2025-03-05T15:00:00Z';

export function harness(opts: { store?: BlobStore; autoAssignMinConfidence?: number; feedbackOnConfirm?: boolean; dir?: string } = {}): Harness {
  const ai = new FakeAi();
  const clock = new FakeClock(new Date(T0));
  const store = opts.store ?? new MemoryBlobStore();
  const repo = new BlobPqrsdRepository(store);
  const events = new EventBus();
  const log: Array<{ event: string; payload: any }> = [];
  events.subscribe((event, payload) => log.push({ event, payload }));
  const client = new AiClient({ baseUrl: 'http://ai.test', fetchImpl: ai.fetch });
  const service = new PqrsdService({
    repo, ai: client, events, clock,
    classifier: new ClassificationService(client, clock),
    taxonomy: new TaxonomyProvider(client, clock),
    deadlineConfig: DEFAULT_DEADLINE_CONFIG,
    autoAssignMinConfidence: opts.autoAssignMinConfidence ?? 0,
    feedbackOnConfirm: opts.feedbackOnConfirm ?? false,
  });
  return { ai, clock, events: log, service, repo, store, cleanup: () => { if (opts.dir) rmSync(opts.dir, { recursive: true, force: true }); } };
}

export function diskHarness(dir = mkdtempSync(join(tmpdir(), 'pqrsd-test-'))): Harness {
  return harness({ store: new FileBlobStore(dir), dir });
}

export const create = (over: Record<string, unknown> = {}) => ({ text: 'Hace tres semanas no llega el agua a mi barrio y tengo un bebé, necesito ayuda.', consent: true, ...over });
