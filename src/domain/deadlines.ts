import { addBusinessDays, businessDaysBetween, nextBusinessDay, type DateStr } from './calendar';
import type { Deadline, PqrsdType, SlaStatus, Subtype } from './types';

export interface DeadlineConfig {
  /** Days for denuncias: depends on the applicable procedure, so it is configurable and flagged «verify». */
  denunciaDays: number;
}

export const DEFAULT_DEADLINE_CONFIG: DeadlineConfig = { denunciaDays: 15 };

const ART14 = 'Art. 14 Ley 1437 de 2011 (sustituido por Ley 1755 de 2015)';

export interface LegalRule {
  type: PqrsdType;
  subtype?: Subtype;
  legalDays: number;
  basis: string;
  verify: boolean;
}

/** The table shown to citizens and used for the calculation. A technical reference, NOT legal advice. */
export function legalRules(cfg: DeadlineConfig = DEFAULT_DEADLINE_CONFIG): LegalRule[] {
  return [
    { type: 'peticion', subtype: 'general', legalDays: 15, basis: `${ART14}: petición general, 15 días hábiles.`, verify: false },
    { type: 'peticion', subtype: 'information', legalDays: 10, basis: `${ART14}: solicitud de información o documentos, 10 días hábiles.`, verify: false },
    { type: 'peticion', subtype: 'consultation', legalDays: 30, basis: `${ART14}: consultas a las autoridades, 30 días hábiles.`, verify: false },
    { type: 'queja', legalDays: 15, basis: `${ART14}: régimen general de peticiones, 15 días hábiles.`, verify: false },
    { type: 'reclamo', legalDays: 15, basis: `${ART14}: régimen general de peticiones, 15 días hábiles.`, verify: false },
    { type: 'sugerencia', legalDays: 15, basis: `${ART14}: régimen general de peticiones, 15 días hábiles.`, verify: false },
    { type: 'denuncia', legalDays: cfg.denunciaDays, basis: `Plazo configurable (${cfg.denunciaDays} días hábiles): depende del procedimiento aplicable; verificar con el área jurídica.`, verify: true },
  ];
}

export function ruleFor(type: PqrsdType, subtype: Subtype | null, cfg: DeadlineConfig = DEFAULT_DEADLINE_CONFIG): LegalRule {
  const rules = legalRules(cfg);
  if (type === 'peticion') return rules.find((r) => r.type === 'peticion' && r.subtype === (subtype ?? 'general'))!;
  return rules.find((r) => r.type === type)!;
}

/**
 * Due date for a case received on `receivedDate` (civil date in Bogotá). A case received on a weekend/holiday is
 * treated as received on the next business day; the term then counts from the following business day.
 */
export function computeDeadline(receivedDate: DateStr, type: PqrsdType, subtype: Subtype | null, cfg: DeadlineConfig = DEFAULT_DEADLINE_CONFIG): Deadline {
  const rule = ruleFor(type, subtype, cfg);
  const countFrom = nextBusinessDay(receivedDate);
  return { legalDays: rule.legalDays, basis: rule.basis, verify: rule.verify, countFrom, dueDate: addBusinessDays(countFrom, rule.legalDays) };
}

export interface SlaInfo {
  slaStatus: SlaStatus;
  /** business days until the due date (negative = days overdue) */
  businessDaysLeft: number;
}

export function atRiskThreshold(legalDays: number): number {
  return Math.max(3, Math.ceil(legalDays * 0.2));
}

export function slaFor(today: DateStr, dueDate: DateStr, legalDays: number, answered: boolean): SlaInfo {
  const left = businessDaysBetween(today, dueDate);
  if (answered) return { slaStatus: 'done', businessDaysLeft: left };
  if (today > dueDate) return { slaStatus: 'overdue', businessDaysLeft: left };
  return { slaStatus: left <= atRiskThreshold(legalDays) ? 'at_risk' : 'on_time', businessDaysLeft: left };
}
