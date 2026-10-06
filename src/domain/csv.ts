import type { PqrsdSummary } from './types';

export const CSV_HEADERS_ES = ['Radicado', 'Fecha de radicación', 'Tipo', 'Dependencia', 'Urgencia', 'Prioridad', 'Estado', 'Vence', 'Días hábiles restantes', 'Semáforo', 'Requiere revisión', 'Origen de la clasificación'] as const;

const esc = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Spreadsheet formula injection guard: a cell that starts with = + - @ is prefixed with a quote. */
const safe = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const STATUS_ES: Record<string, string> = { pending_review: 'En revisión', assigned: 'Asignada', answered: 'Respondida', closed: 'Cerrada' };
const SLA_ES: Record<string, string> = { on_time: 'En términos', at_risk: 'En riesgo', overdue: 'Vencida', done: 'Respondida' };

/** UTF-8 CSV with BOM (Excel-friendly). Never includes the citizen's text or personal data. */
export function casesToCsv(items: Iterable<PqrsdSummary>): string {
  const lines = [CSV_HEADERS_ES.join(',')];
  for (const s of items) {
    lines.push(
      [s.radicado, s.receivedAt.slice(0, 10), s.type.label, s.dependency.name, s.urgency.label, String(s.priorityScore), STATUS_ES[s.status] ?? s.status, s.dueDate, String(s.businessDaysLeft), SLA_ES[s.slaStatus] ?? s.slaStatus, s.needsReview ? 'Sí' : 'No', s.source === 'ai' ? 'IA' : 'Respaldo por palabras clave']
        .map((c) => esc(safe(c)))
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
