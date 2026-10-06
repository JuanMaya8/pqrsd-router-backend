import { bogotaDate, addDays, addBusinessDays, isBusinessDay, type DateStr } from './calendar';
import type { AiClient } from './ai-client';
import type { ClassificationService, TaxonomyProvider } from './classification-service';
import type { Clock } from './clock';
import { casesToCsv } from './csv';
import { computeDeadline, slaFor, type DeadlineConfig } from './deadlines';
import { demoText, mulberry32 } from './demo-data';
import { NotFoundError, ValidationError } from './errors';
import type { EventBus } from './events';
import { PUBLIC_EVENT_LABELS, STATUS_LABELS, SLA_LABELS, depName, labelOf } from './labels';
import { formatRadicado, codesMatch, newId, newTrackingCode, RADICADO_RE } from './ids';
import type { PqrsdRepository } from './repository';
import { publicStats, staffStats, type PublicStats, type StaffStats } from './stats';
import { queryCases, redactPii, scrubCitizen, toDetail, toSummary } from './summary';
import { FALLBACK_DEPENDENCY, type Channel, type Citizen, type Effective, type Page, type PqrsdDetail, type PqrsdRecord, type PqrsdSummary, type Receipt, type SlaStatus, type Status, type StoredClassification, type TimelineEvent, type Urgency } from './types';
import { parseCreate, parseListQuery, parseNote, parseAnswer, parseImport, parsePreview, parseReclassify, parseSeed, type ListQuery } from './validation';
import { transition } from './workflow';

export interface ServiceDeps {
  repo: PqrsdRepository;
  classifier: ClassificationService;
  taxonomy: TaxonomyProvider;
  ai: AiClient;
  events: EventBus;
  clock: Clock;
  deadlineConfig: DeadlineConfig;
  /** 0 = off */
  autoAssignMinConfidence: number;
  feedbackOnConfirm: boolean;
}

/** Priority assigned when staff overrides the urgency (the AI's own score no longer applies). */
export const URGENCY_PRIORITY: Record<Urgency, number> = { critical: 92, high: 72, medium: 42, low: 15 };

export interface PreviewResult {
  classification: {
    source: 'ai' | 'fallback';
    type: { id: string; label: string; confidence: number; reasons: string[] };
    dependency: { id: string; name: string; confidence: number; reasons: string[] };
    urgency: { id: string; label: string; confidence: number; reasons: string[] };
    subtype: { id: string; label: string } | null;
    needsReview: boolean;
    entities: Array<{ type: string; label: string; text: string; value: string | null }>;
  };
  deadline: { legalDays: number; dueDate: DateStr; basis: string };
}

export interface TrackingView {
  radicado: string;
  status: Status;
  statusLabel: string;
  type: { id: string; label: string };
  dependency: { id: string; name: string };
  urgency: { id: string; label: string };
  receivedAt: string;
  dueDate: DateStr;
  slaStatus: SlaStatus;
  slaLabel: string;
  businessDaysLeft: number;
  timeline: Array<{ at: string; event: string; label: string }>;
  response: { text: string; answeredAt: string } | null;
}

export interface AiStatus {
  available: boolean;
  modelVersion: string | null;
  model?: { syntheticSamples: number; feedbackSamples: number; trainedAt: number | null; note: string };
  feedback?: { total: number; sinceLastTraining: number };
}

const dateEs = (d: DateStr): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'UTC' });

export class PqrsdService {
  private readonly inFlight = new Set<Promise<unknown>>();
  constructor(private readonly d: ServiceDeps) {}

  /** Resolves when background work (AI feedback) is done. Used by tests and on shutdown. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private background(p: Promise<unknown>): void {
    const tracked = p.catch(() => undefined).finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }

  private today(): DateStr {
    return bogotaDate(this.d.clock.now());
  }

  // ------------------------------------------------------------------ citizen
  async preview(raw: unknown): Promise<PreviewResult> {
    const { text } = parsePreview(raw);
    const [cls, tax] = [await this.d.classifier.classify(text), await this.d.taxonomy.get()];
    const { effective } = this.effectiveFrom(cls, tax.dependencies.map((x) => x.id), tax.fallbackDependency);
    const dl = computeDeadline(this.today(), effective.type, effective.subtype, this.d.deadlineConfig);
    return {
      classification: {
        source: cls.source,
        type: { id: effective.type, label: labelOf(tax.types, effective.type), confidence: cls.type.confidence, reasons: cls.type.reasons },
        dependency: { id: effective.dependency, name: depName(tax, effective.dependency), confidence: cls.dependency.confidence, reasons: cls.dependency.reasons },
        urgency: { id: effective.urgency, label: labelOf(tax.urgency, effective.urgency), confidence: cls.urgency.confidence, reasons: cls.urgency.reasons },
        subtype: effective.subtype ? { id: effective.subtype, label: labelOf(tax.subtypes, effective.subtype) } : null,
        needsReview: cls.needsReview,
        entities: cls.entities.filter((e) => !e.pii).map((e) => ({ type: e.type, label: e.label, text: e.text, value: e.value })),
      },
      deadline: { legalDays: dl.legalDays, dueDate: dl.dueDate, basis: dl.basis },
    };
  }

  async create(raw: unknown): Promise<Receipt> {
    const input = parseCreate(raw);
    const now = this.d.clock.now();
    const cls = await this.d.classifier.classify(input.text, now);
    const [rec] = await this.persistNew([{ text: input.text, channel: input.channel, citizen: input.citizen, receivedAt: now, cls }], false);
    const tax = await this.d.taxonomy.get();
    const anon = input.anonymous || !input.citizen?.email;
    return {
      radicado: rec.radicado,
      trackingCode: rec.trackingCode,
      receivedAt: rec.receivedAt,
      type: { id: rec.effective.type, label: labelOf(tax.types, rec.effective.type) },
      dependency: { id: rec.effective.dependency, name: depName(tax, rec.effective.dependency) },
      dueDate: rec.deadline.dueDate,
      legalDays: rec.deadline.legalDays,
      message:
        `Tu solicitud quedó radicada con el número ${rec.radicado}. La entidad debe responder a más tardar el ${dateEs(rec.deadline.dueDate)} (${rec.deadline.legalDays} días hábiles). ` +
        `Guarda este código de seguimiento: ${rec.trackingCode}.` +
        (anon ? ' Como no dejaste un correo, solo podrás conocer la respuesta consultando con tu número y tu código.' : ''),
    };
  }

  async tracking(radicado: string, code: string | undefined): Promise<TrackingView> {
    const notFound = new NotFoundError('solicitud', radicado);
    if (!RADICADO_RE.test(radicado) || !code) throw notFound;
    const rec = await this.d.repo.findByRadicado(radicado);
    if (!rec || !codesMatch(rec.trackingCode, code)) throw notFound; // same answer for «no existe» and «código incorrecto»
    const tax = await this.d.taxonomy.get();
    const s = toSummary(rec, this.today(), tax);
    return {
      radicado: rec.radicado,
      status: rec.status,
      statusLabel: STATUS_LABELS[rec.status],
      type: s.type,
      dependency: s.dependency,
      urgency: s.urgency,
      receivedAt: rec.receivedAt,
      dueDate: rec.deadline.dueDate,
      slaStatus: s.slaStatus,
      slaLabel: SLA_LABELS[s.slaStatus],
      businessDaysLeft: s.businessDaysLeft,
      timeline: rec.timeline.map((t) => ({ at: t.at, event: t.event, label: PUBLIC_EVENT_LABELS[t.event] ?? t.event })),
      response: rec.response,
    };
  }

  async transparency(): Promise<PublicStats> {
    return publicStats(await this.d.repo.all(), this.d.clock.now(), await this.d.taxonomy.get(), this.d.deadlineConfig);
  }

  taxonomy() {
    return this.d.taxonomy.get();
  }

  // ------------------------------------------------------------------ staff
  private async load(id: string): Promise<PqrsdRecord> {
    const rec = await this.d.repo.get(id);
    if (!rec) throw new NotFoundError('PQRSD', id);
    return rec;
  }

  async list(rawQuery: Record<string, unknown>): Promise<Page<PqrsdSummary>> {
    return queryCases(await this.d.repo.all(), parseListQuery(rawQuery), this.today(), await this.d.taxonomy.get());
  }

  async get(id: string): Promise<PqrsdDetail> {
    return toDetail(await this.load(id), this.today(), await this.d.taxonomy.get());
  }

  private event(rec: PqrsdRecord, event: TimelineEvent['event'], by: TimelineEvent['by'], detail?: string): void {
    rec.timeline.push({ at: this.d.clock.now().toISOString(), event, by, ...(detail ? { detail } : {}) });
  }

  private async emitUpdated(rec: PqrsdRecord): Promise<PqrsdDetail> {
    const detail = toDetail(rec, this.today(), await this.d.taxonomy.get());
    this.d.events.publish('pqrsd.updated', { id: rec.id, radicado: rec.radicado, status: rec.status, slaStatus: detail.slaStatus });
    this.d.events.publish('stats.changed', { at: this.d.clock.now().toISOString() });
    return detail;
  }

  async confirm(id: string, raw: unknown): Promise<PqrsdDetail> {
    const { note } = parseNote(raw);
    const rec = await this.load(id);
    rec.status = transition(rec.status, 'confirm');
    rec.reviewed = true;
    this.event(rec, 'confirmed', 'staff', note);
    await this.d.repo.update(rec);
    if (this.d.feedbackOnConfirm) this.sendFeedback(rec);
    return this.emitUpdated(rec);
  }

  async reclassify(id: string, raw: unknown): Promise<PqrsdDetail> {
    const input = parseReclassify(raw);
    const rec = await this.load(id);
    const tax = await this.d.taxonomy.get();
    if (input.dependency && !tax.dependencies.some((x) => x.id === input.dependency)) throw new ValidationError([`La dependencia «${input.dependency}» no existe.`]);
    const next: Effective = { ...rec.effective };
    if (input.type) next.type = input.type;
    if (input.dependency) next.dependency = input.dependency;
    if (input.urgency) next.urgency = input.urgency;
    if (input.subtype && next.type !== 'peticion') throw new ValidationError(['El subtipo solo aplica a las peticiones.']);
    if (next.type === 'peticion') next.subtype = input.subtype ?? rec.effective.subtype ?? 'general';
    else next.subtype = null;
    rec.status = transition(rec.status, 'reclassify');
    const changes: string[] = [];
    if (next.type !== rec.effective.type) changes.push(`tipo: ${labelOf(tax.types, rec.effective.type)} → ${labelOf(tax.types, next.type)}`);
    if (next.dependency !== rec.effective.dependency) changes.push(`dependencia: ${depName(tax, rec.effective.dependency)} → ${depName(tax, next.dependency)}`);
    if (next.urgency !== rec.effective.urgency) changes.push(`urgencia: ${labelOf(tax.urgency, rec.effective.urgency)} → ${labelOf(tax.urgency, next.urgency)}`);
    if (next.subtype !== rec.effective.subtype) changes.push(`subtipo: ${next.subtype ? labelOf(tax.subtypes, next.subtype) : 'ninguno'}`);
    rec.effective = next;
    const c = rec.classification;
    rec.changedByStaff = next.type !== c.type.id || next.dependency !== c.dependency.id || next.urgency !== c.urgency.id;
    rec.priorityScore = next.urgency === c.urgency.id ? c.urgency.priorityScore : URGENCY_PRIORITY[next.urgency];
    // the legal term depends on the type/subtype and always counts from the ORIGINAL receipt date
    rec.deadline = computeDeadline(bogotaDate(rec.receivedAt), next.type, next.subtype, this.d.deadlineConfig);
    rec.reviewed = true;
    this.event(rec, 'reclassified', 'staff', [changes.join('; '), input.note].filter(Boolean).join(' — ') || undefined);
    await this.d.repo.update(rec);
    if (changes.length) this.sendFeedback(rec);
    return this.emitUpdated(rec);
  }

  async answer(id: string, raw: unknown): Promise<PqrsdDetail> {
    const { response } = parseAnswer(raw);
    const rec = await this.load(id);
    rec.status = transition(rec.status, 'answer');
    rec.response = { text: response, answeredAt: this.d.clock.now().toISOString() };
    this.event(rec, 'answered', 'staff');
    await this.d.repo.update(rec);
    return this.emitUpdated(rec);
  }

  async close(id: string): Promise<PqrsdDetail> {
    const rec = await this.load(id);
    rec.status = transition(rec.status, 'close');
    this.event(rec, 'closed', 'staff');
    await this.d.repo.update(rec);
    return this.emitUpdated(rec);
  }

  /** Sends the human-corrected labels to the AI, with personal data redacted. Never blocks or fails the request. */
  private sendFeedback(rec: PqrsdRecord): void {
    if (rec.isDemo || this.d.classifier.aiLooksDown) return;
    this.background(
      this.d.ai.feedback({
        text: scrubCitizen(redactPii(rec.text, rec.classification.entities), rec.citizen),
        type: rec.effective.type,
        dependency: rec.effective.dependency,
        urgency: rec.effective.urgency,
        ...(rec.effective.subtype ? { subtype: rec.effective.subtype } : {}),
        source_id: rec.radicado,
      }),
    );
  }

  async stats(): Promise<StaffStats> {
    const records = await this.d.repo.all();
    return staffStats(records, this.today(), await this.d.taxonomy.get(), !this.d.classifier.aiLooksDown);
  }

  async exportCsv(rawQuery: Record<string, unknown>): Promise<string> {
    const q: ListQuery = { ...parseListQuery(rawQuery), limit: 200, offset: 0 };
    const tax = await this.d.taxonomy.get();
    const all = queryCases(await this.d.repo.all(), { ...q, limit: Number.MAX_SAFE_INTEGER }, this.today(), tax);
    return casesToCsv(all.items);
  }

  // ------------------------------------------------------------------ bulk / demo
  async importMany(raw: unknown): Promise<{ imported: number; needsReview: number; durationMs: number }> {
    const t0 = Date.now();
    const input = parseImport(raw);
    const now = this.d.clock.now();
    const classified = await this.d.classifier.classifyMany(input.items.map((i) => i.text), bogotaDate(now));
    const recs = await this.persistNew(
      input.items.map((it, i) => ({ text: it.text, channel: 'web' as Channel, citizen: null, receivedAt: it.receivedAt ? new Date(it.receivedAt) : now, cls: classified[i] })),
      input.isDemo,
    );
    return { imported: recs.length, needsReview: recs.filter((r) => r.classification.needsReview).length, durationMs: Date.now() - t0 };
  }

  /** Demo cases spread over the last ~6 weeks, some already answered (on time and late), so every screen has data. */
  async seedDemo(raw: unknown, seed = Date.now()): Promise<{ created: number }> {
    const { count } = parseSeed(raw);
    const rng = mulberry32(seed);
    const now = this.d.clock.now();
    const today = bogotaDate(now);
    const items: Array<{ text: string; receivedAt: Date }> = [];
    for (let i = 0; i < count; i += 1) {
      const daysAgo = Math.floor(rng() * rng() * 42); // more recent cases than old ones
      let day = addDays(today, -daysAgo);
      while (!isBusinessDay(day)) day = addDays(day, -1);
      const at = new Date(`${day}T${String(13 + Math.floor(rng() * 8)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:00Z`); // 08:00–15:59 Bogotá
      items.push({ text: demoText(rng), receivedAt: at > now ? now : at });
    }
    const classified = await this.d.classifier.classifyMany(items.map((i) => i.text), today);
    const recs = await this.persistNew(items.map((it, i) => ({ text: it.text, channel: 'web' as Channel, citizen: null, receivedAt: it.receivedAt, cls: classified[i] })), true, false);
    for (const r of recs) this.simulateProgress(r, rng, now);
    await this.d.repo.insertMany(recs);
    this.d.events.publish('stats.changed', { at: now.toISOString() });
    return { created: recs.length };
  }

  private simulateProgress(r: PqrsdRecord, rng: () => number, now: Date): void {
    const received = bogotaDate(r.receivedAt);
    const age = Math.max(0, Math.round((now.getTime() - new Date(r.receivedAt).getTime()) / 86_400_000));
    if (age < 1) return;
    if (r.status === 'pending_review' && rng() < 0.5) {
      r.status = 'assigned';
      r.reviewed = true;
      r.changedByStaff = rng() < 0.15; // staff disagrees with the AI about 15 % of the time in the demo
      this.event(r, 'confirmed', 'staff');
    }
    if (age >= 3 && rng() < 0.6) {
      // answered between day 2 and legalDays + 4 business days (the tail is late on purpose)
      const spent = 2 + Math.floor(rng() * (r.deadline.legalDays + 3));
      let when = addBusinessDays(r.deadline.countFrom, spent);
      if (when > bogotaDate(now)) when = bogotaDate(now);
      r.status = rng() < 0.4 && age > 10 ? 'closed' : 'answered';
      r.response = { text: 'Respuesta de demostración: su solicitud fue atendida por la dependencia competente.', answeredAt: `${when}T17:00:00.000Z` };
      this.event(r, 'answered', 'staff');
      if (r.status === 'closed') this.event(r, 'closed', 'staff');
    }
    void received;
  }

  async deleteDemo(): Promise<{ deleted: number }> {
    const deleted = await this.d.repo.removeWhere((r) => r.isDemo);
    this.d.events.publish('stats.changed', { at: this.d.clock.now().toISOString() });
    return { deleted };
  }

  // ------------------------------------------------------------------ AI admin
  async aiStatus(): Promise<AiStatus> {
    try {
      const h = await this.d.ai.health();
      const [model, fb] = await Promise.all([this.d.ai.model().catch(() => null), this.d.ai.feedbackStats().catch(() => null)]);
      return {
        available: true,
        modelVersion: h.model_version ?? model?.model_version ?? null,
        ...(model ? { model: { syntheticSamples: model.synthetic_samples, feedbackSamples: model.feedback_samples, trainedAt: model.trained_at, note: model.note } } : {}),
        ...(fb ? { feedback: { total: fb.total, sinceLastTraining: fb.since_last_training } } : {}),
      };
    } catch {
      return { available: false, modelVersion: null };
    }
  }

  async retrainAi(): Promise<AiStatus> {
    await this.d.ai.retrain();
    return this.aiStatus();
  }

  async health(): Promise<{ available: boolean; modelVersion: string | null }> {
    try {
      const h = await this.d.ai.health();
      return { available: true, modelVersion: h.model_version ?? null };
    } catch {
      return { available: false, modelVersion: null };
    }
  }

  // ------------------------------------------------------------------ internals
  private effectiveFrom(cls: StoredClassification, depIds: string[], fallbackDep: string): { effective: Effective } {
    const type = cls.type.id;
    return {
      effective: {
        type,
        subtype: type === 'peticion' ? cls.subtype?.id ?? 'general' : null,
        dependency: depIds.includes(cls.dependency.id) ? cls.dependency.id : fallbackDep || FALLBACK_DEPENDENCY,
        urgency: cls.urgency.id,
      },
    };
  }

  private async persistNew(
    items: Array<{ text: string; channel: Channel; citizen: Citizen | null; receivedAt: Date; cls: StoredClassification }>,
    isDemo: boolean,
    save = true,
  ): Promise<PqrsdRecord[]> {
    const tax = await this.d.taxonomy.get();
    const depIds = tax.dependencies.map((x) => x.id);
    // one counter reservation per year, then assign in order
    const years = new Map<number, number>();
    for (const it of items) {
      const y = Number(bogotaDate(it.receivedAt).slice(0, 4));
      years.set(y, (years.get(y) ?? 0) + 1);
    }
    const next = new Map<number, number>();
    for (const [y, n] of years) next.set(y, await this.d.repo.reserve(y, n));
    const recs: PqrsdRecord[] = items.map((it) => {
      const y = Number(bogotaDate(it.receivedAt).slice(0, 4));
      const seq = next.get(y)!;
      next.set(y, seq + 1);
      const { effective } = this.effectiveFrom(it.cls, depIds, tax.fallbackDependency);
      const at = it.receivedAt.toISOString();
      const autoAssign =
        this.d.autoAssignMinConfidence > 0 && it.cls.source === 'ai' && !it.cls.needsReview && Math.min(it.cls.type.confidence, it.cls.dependency.confidence) >= this.d.autoAssignMinConfidence;
      const rec: PqrsdRecord = {
        id: newId(),
        radicado: formatRadicado(y, seq),
        trackingCode: newTrackingCode(),
        text: it.text,
        channel: it.channel,
        citizen: it.citizen,
        receivedAt: at,
        classification: it.cls,
        effective,
        priorityScore: it.cls.urgency.priorityScore,
        status: autoAssign ? 'assigned' : 'pending_review',
        reviewed: false,
        changedByStaff: false,
        deadline: computeDeadline(bogotaDate(it.receivedAt), effective.type, effective.subtype, this.d.deadlineConfig),
        timeline: [
          { at, event: 'received', by: 'citizen' },
          { at, event: 'classified', by: it.cls.source === 'ai' ? 'ai' : 'fallback', detail: `${labelOf(tax.types, effective.type)} · ${depName(tax, effective.dependency)} · urgencia ${labelOf(tax.urgency, effective.urgency).toLowerCase()}` },
        ],
        response: null,
        isDemo,
      };
      return rec;
    });
    if (save) {
      if (recs.length === 1) await this.d.repo.insert(recs[0]);
      else await this.d.repo.insertMany(recs);
      const t = this.d.clock.now().toISOString();
      for (const rec of recs.length <= 50 ? recs : []) {
        this.d.events.publish('pqrsd.created', { id: rec.id, radicado: rec.radicado, type: rec.effective.type, dependency: rec.effective.dependency, urgency: rec.effective.urgency, priorityScore: rec.priorityScore, needsReview: rec.classification.needsReview });
      }
      this.d.events.publish('stats.changed', { at: t });
    }
    return recs;
  }
}

export { slaFor };
