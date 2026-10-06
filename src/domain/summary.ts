import { bogotaDate, type DateStr } from './calendar';
import { slaFor } from './deadlines';
import { depName, labelOf } from './labels';
import type { ListQuery } from './validation';
import type { Citizen, Entity, PqrsdDetail, PqrsdRecord, PqrsdSummary, TaxonomyDto } from './types';

export function toSummary(r: PqrsdRecord, today: DateStr, tax: TaxonomyDto): PqrsdSummary {
  const sla = slaFor(today, r.deadline.dueDate, r.deadline.legalDays, r.status === 'answered' || r.status === 'closed');
  return {
    id: r.id,
    radicado: r.radicado,
    receivedAt: r.receivedAt,
    excerpt: r.text.length > 160 ? `${r.text.slice(0, 157).trimEnd()}…` : r.text,
    status: r.status,
    type: { id: r.effective.type, label: labelOf(tax.types, r.effective.type) },
    dependency: { id: r.effective.dependency, name: depName(tax, r.effective.dependency) },
    urgency: { id: r.effective.urgency, label: labelOf(tax.urgency, r.effective.urgency) },
    priorityScore: r.priorityScore,
    needsReview: r.classification.needsReview && !r.reviewed,
    dueDate: r.deadline.dueDate,
    businessDaysLeft: sla.businessDaysLeft,
    slaStatus: sla.slaStatus,
    source: r.classification.source,
    isDemo: r.isDemo,
  };
}

export function toDetail(r: PqrsdRecord, today: DateStr, tax: TaxonomyDto): PqrsdDetail {
  const c = r.classification;
  return {
    ...toSummary(r, today, tax),
    text: r.text,
    channel: r.channel,
    citizen: r.citizen,
    classification: { source: c.source, type: c.type, dependency: c.dependency, urgency: c.urgency, subtype: c.subtype, entities: c.entities, reviewReasons: c.reviewReasons, modelVersion: c.modelVersion },
    effective: r.effective,
    deadline: r.deadline,
    timeline: r.timeline,
    response: r.response,
  };
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Ranking used by the default inbox order: priority plus a bonus when the legal term is already in danger.
 * Resolved cases (answered/closed → slaStatus «done») sink below every open one: they need no action, however urgent they were.
 */
export function rankScore(s: Pick<PqrsdSummary, 'priorityScore' | 'slaStatus'>): number {
  if (s.slaStatus === 'done') return s.priorityScore - 1000;
  return s.priorityScore + (s.slaStatus === 'overdue' ? 20 : s.slaStatus === 'at_risk' ? 8 : 0);
}

export function queryCases(records: PqrsdRecord[], q: ListQuery, today: DateStr, tax: TaxonomyDto): { items: PqrsdSummary[]; total: number } {
  const needle = q.q ? fold(q.q) : null;
  const rows: Array<{ s: PqrsdSummary; r: PqrsdRecord }> = [];
  for (const r of records) {
    if (q.isDemo !== undefined && r.isDemo !== q.isDemo) continue;
    if (q.status && r.status !== q.status) continue;
    if (q.type && r.effective.type !== q.type) continue;
    if (q.dependency && r.effective.dependency !== q.dependency) continue;
    if (q.urgency && r.effective.urgency !== q.urgency) continue;
    if (needle && !fold(r.text).includes(needle) && !fold(r.radicado).includes(needle)) continue;
    const s = toSummary(r, today, tax);
    if (q.sla && s.slaStatus !== q.sla) continue;
    if (q.needsReview !== undefined && s.needsReview !== q.needsReview) continue;
    rows.push({ s, r });
  }
  const by: Record<ListQuery['sort'], (a: { s: PqrsdSummary }, b: { s: PqrsdSummary }) => number> = {
    'priority:desc': (a, b) => rankScore(b.s) - rankScore(a.s) || a.s.dueDate.localeCompare(b.s.dueDate) || a.s.receivedAt.localeCompare(b.s.receivedAt),
    'dueDate:asc': (a, b) => Number(a.s.slaStatus === 'done') - Number(b.s.slaStatus === 'done') || a.s.dueDate.localeCompare(b.s.dueDate) || rankScore(b.s) - rankScore(a.s),
    'receivedAt:desc': (a, b) => b.s.receivedAt.localeCompare(a.s.receivedAt),
  };
  rows.sort(by[q.sort]);
  return { items: rows.slice(q.offset, q.offset + q.limit).map((x) => x.s), total: rows.length };
}

/** Replaces personal-data entities with placeholders (offsets refer to the original text). Used before sending a text to the AI as feedback. */
export function redactPii(text: string, entities: Entity[]): string {
  const pii = entities.filter((e) => e.pii && e.start >= 0 && e.end <= text.length && e.end > e.start).sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const e of pii) {
    if (e.end > lastStart) continue; // overlapping span: skip
    out = `${out.slice(0, e.start)}[${e.label.toUpperCase()}]${out.slice(e.end)}`;
    lastStart = e.start;
  }
  return out;
}

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Defence in depth for what leaves the system as AI feedback: besides the entities the AI flagged, removes whatever the citizen
 * declared in the form (name and each name part, email, phone and document, tolerant to separators) that still appears in the text.
 */
export function scrubCitizen(text: string, citizen: Citizen | null): string {
  if (!citizen) return text;
  let out = text;
  const digits = (v: string): string => v.replace(/\D/g, '').split('').map(escapeRe).join('[\\s.-]*');
  if (citizen.email) out = out.replace(new RegExp(escapeRe(citizen.email), 'gi'), '[CORREO]');
  for (const [v, label] of [[citizen.phone, 'TELÉFONO'], [citizen.documentId, 'DOCUMENTO']] as const) {
    if (v && v.replace(/\D/g, '').length >= 4) out = out.replace(new RegExp(digits(v), 'g'), `[${label}]`);
  }
  if (citizen.name) {
    const parts = citizen.name.split(/\s+/).filter((p) => p.length >= 4);
    for (const p of [citizen.name, ...parts]) out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(p)}(?![\\p{L}])`, 'giu'), '[PERSONA]');
  }
  return out;
}

export const todayOf = (now: Date): DateStr => bogotaDate(now);
