import type { PqrsdType, StoredClassification, Urgency } from './types';
import { FALLBACK_DEPENDENCY } from './types';

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const has = (text: string, words: string[]): string[] => words.filter((w) => new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`).test(text));

const TYPE_WORDS: Array<[PqrsdType, string[]]> = [
  ['denuncia', ['denuncio', 'denuncia', 'denunciar', 'corrupcion', 'soborno', 'coima', 'fraude']],
  ['queja', ['queja', 'mala atencion', 'maltrato', 'grosero', 'grosera', 'falta de respeto']],
  ['sugerencia', ['sugiero', 'sugerencia', 'propongo', 'recomiendo', 'seria bueno']],
  ['reclamo', ['reclamo', 'no funciona', 'no llega', 'no han arreglado', 'cobro', 'mal servicio']],
];
const CRITICAL_WORDS = ['fuga de gas', 'cable caido', 'derrumbe', 'incendio', 'riesgo de muerte', 'amenaza de muerte', 'emergencia', 'electrocut\\w*', 'herido', 'heridos'];
const HIGH_WORDS = ['urgente', 'tutela', 'adulto mayor', 'embarazada', 'discapacidad', 'sin agua', 'sin medicamento', 'plazo vencido', 'vencio el termino'];

/**
 * Last-resort classifier used when the AI service is unreachable. It is deliberately conservative:
 *  - type by keywords, default «petición» (the broadest legal regime, 15 business days);
 *  - dependency ALWAYS «Atención al Ciudadano» (it re-routes by hand);
 *  - critical/high only on unmistakable phrases;
 *  - always `needsReview = true`.
 */
export function fallbackClassify(text: string): StoredClassification {
  const t = norm(text);
  let type: PqrsdType = 'peticion';
  let typeEvidence: string[] = [];
  for (const [id, words] of TYPE_WORDS) {
    const found = has(t, words);
    if (found.length) {
      type = id;
      typeEvidence = found;
      break;
    }
  }
  const crit = has(t, CRITICAL_WORDS);
  const high = has(t, HIGH_WORDS);
  const urgency: Urgency = crit.length ? 'critical' : high.length ? 'high' : 'medium';
  const priorityScore = { critical: 90, high: 70, medium: 42, low: 15 }[urgency];
  return {
    source: 'fallback',
    type: { id: type, confidence: typeEvidence.length ? 0.5 : 0.3, reasons: [typeEvidence.length ? `Clasificación básica por palabras clave: «${typeEvidence.join('», «')}».` : 'Sin señales claras: se asume una petición.'] },
    dependency: { id: FALLBACK_DEPENDENCY, confidence: 0, routedToFallback: true, reasons: ['La IA no estaba disponible: un funcionario debe asignar la dependencia competente.'] },
    urgency: { id: urgency, confidence: crit.length || high.length ? 0.6 : 0.3, priorityScore, reasons: [crit.length ? `Posible riesgo vital («${crit.join('», «')}»): revisar de inmediato.` : high.length ? `Señales de urgencia («${high.join('», «')}»).` : 'Sin señales de urgencia.'] },
    subtype: type === 'peticion' ? { id: 'general', confidence: 0.3 } : null,
    entities: [],
    needsReview: true,
    reviewReasons: ['La IA no estaba disponible: clasificación básica por palabras clave. Revise tipo, dependencia y urgencia.'],
    modelVersion: 'fallback-keywords',
  };
}
