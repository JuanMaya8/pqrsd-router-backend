import { addDays, bogotaDate, businessDaysBetween, dayOfWeek, type DateStr } from './calendar';
import { DEFAULT_DEADLINE_CONFIG, legalRules, slaFor, type DeadlineConfig } from './deadlines';
import { depName, labelOf } from './labels';
import { isAnswered, isOpen } from './workflow';
import type { PqrsdRecord, TaxonomyDto } from './types';

interface Counted { id: string; label: string; count: number }
const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;
const answeredDate = (r: PqrsdRecord): DateStr | null => (r.response ? bogotaDate(r.response.answeredAt) : null);

function responseMetrics(records: PqrsdRecord[]): { onTimeRate: number | null; avgBusinessDaysToAnswer: number | null } {
  const answered = records.filter((r) => r.response);
  if (!answered.length) return { onTimeRate: null, avgBusinessDaysToAnswer: null };
  let onTime = 0;
  let days = 0;
  for (const r of answered) {
    const d = answeredDate(r)!;
    if (d <= r.deadline.dueDate) onTime += 1;
    days += Math.max(0, businessDaysBetween(r.deadline.countFrom, d));
  }
  return { onTimeRate: round(onTime / answered.length, 3), avgBusinessDaysToAnswer: round(days / answered.length, 1) };
}

export interface StaffStats {
  totals: { all: number; open: number; pending_review: number; overdue: number; atRisk: number; needsReview: number };
  byType: Counted[];
  byDependency: Array<{ id: string; name: string; count: number; openCount: number; overdueCount: number }>;
  byUrgency: Counted[];
  avgPriority: number | null;
  avgBusinessDaysToAnswer: number | null;
  onTimeRate: number | null;
  aiAgreementRate: number | null;
  aiAvailable: boolean;
}

function dependencyRows(records: PqrsdRecord[], today: DateStr, tax: TaxonomyDto) {
  return tax.dependencies.map((d) => {
    const mine = records.filter((r) => r.effective.dependency === d.id);
    const open = mine.filter((r) => isOpen(r.status));
    return { id: d.id, name: d.name, count: mine.length, openCount: open.length, overdueCount: open.filter((r) => slaFor(today, r.deadline.dueDate, r.deadline.legalDays, false).slaStatus === 'overdue').length };
  });
}

export function staffStats(records: PqrsdRecord[], today: DateStr, tax: TaxonomyDto, aiAvailable: boolean): StaffStats {
  const open = records.filter((r) => isOpen(r.status));
  const sla = open.map((r) => slaFor(today, r.deadline.dueDate, r.deadline.legalDays, false).slaStatus);
  const reviewed = records.filter((r) => r.reviewed && r.classification.source === 'ai');
  return {
    totals: {
      all: records.length,
      open: open.length,
      pending_review: records.filter((r) => r.status === 'pending_review').length,
      overdue: sla.filter((s) => s === 'overdue').length,
      atRisk: sla.filter((s) => s === 'at_risk').length,
      needsReview: open.filter((r) => r.classification.needsReview && !r.reviewed).length,
    },
    byType: tax.types.map((t) => ({ id: t.id, label: t.label, count: records.filter((r) => r.effective.type === t.id).length })),
    byDependency: dependencyRows(records, today, tax),
    byUrgency: tax.urgency.map((u) => ({ id: u.id, label: u.label, count: records.filter((r) => r.effective.urgency === u.id).length })),
    avgPriority: open.length ? round(open.reduce((a, r) => a + r.priorityScore, 0) / open.length) : null,
    ...responseMetrics(records),
    aiAgreementRate: reviewed.length ? round(reviewed.filter((r) => !r.changedByStaff).length / reviewed.length, 3) : null,
    aiAvailable,
  };
}

export interface PublicStats {
  generatedAt: string;
  includesDemo: boolean;
  totals: { received: number; answered: number; open: number; overdue: number };
  onTimeRate: number | null;
  avgBusinessDaysToAnswer: number | null;
  byType: Counted[];
  byDependency: Array<{ id: string; name: string; count: number; openCount: number; overdueCount: number }>;
  weekly: Array<{ weekStart: DateStr; received: number; answered: number }>;
  deadlines: Array<{ type: string; subtype?: string; legalDays: number; basis: string }>;
}

export function mondayOf(d: DateStr): DateStr {
  const dow = dayOfWeek(d);
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

/** Aggregates only: no text, no citizen, no radicado. */
export function publicStats(records: PqrsdRecord[], now: Date, tax: TaxonomyDto, cfg: DeadlineConfig = DEFAULT_DEADLINE_CONFIG, weeks = 12): PublicStats {
  const today = bogotaDate(now);
  const open = records.filter((r) => isOpen(r.status));
  const thisMonday = mondayOf(today);
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const weekStart = addDays(thisMonday, -7 * (weeks - 1 - i));
    const weekEnd = addDays(weekStart, 6);
    return {
      weekStart,
      received: records.filter((r) => { const d = bogotaDate(r.receivedAt); return d >= weekStart && d <= weekEnd; }).length,
      answered: records.filter((r) => { const d = answeredDate(r); return d !== null && d >= weekStart && d <= weekEnd; }).length,
    };
  });
  return {
    generatedAt: now.toISOString(),
    includesDemo: records.some((r) => r.isDemo),
    totals: {
      received: records.length,
      answered: records.filter((r) => isAnswered(r.status)).length,
      open: open.length,
      overdue: open.filter((r) => slaFor(today, r.deadline.dueDate, r.deadline.legalDays, false).slaStatus === 'overdue').length,
    },
    ...responseMetrics(records),
    byType: tax.types.map((t) => ({ id: t.id, label: labelOf(tax.types, t.id), count: records.filter((r) => r.effective.type === t.id).length })),
    byDependency: dependencyRows(records, today, tax).map((d) => ({ ...d, name: depName(tax, d.id) })),
    weekly,
    deadlines: legalRules(cfg).map((r) => ({ type: r.type, ...(r.subtype ? { subtype: r.subtype } : {}), legalDays: r.legalDays, basis: r.basis })),
  };
}
