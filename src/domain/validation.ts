import { CHANNELS, PQRSD_TYPES, STATUSES, SLA_STATUSES, SUBTYPES, URGENCIES, type Channel, type Citizen, type PqrsdType, type SlaStatus, type Status, type Subtype, type Urgency } from './types';
import { ValidationError } from './errors';

export const MIN_TEXT = 10;
export const MAX_TEXT = 10_000;
export const MAX_IMPORT = 5000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function body(raw: unknown): Obj {
  if (!isObj(raw)) throw new ValidationError(['El cuerpo debe ser un objeto JSON.']);
  return raw;
}

function textField(o: Obj, errors: string[], field = 'text', label = 'El texto'): string {
  const t = o[field];
  if (typeof t !== 'string') {
    errors.push(`${label} es obligatorio.`);
    return '';
  }
  const v = t.replace(/\u0000/g, '').trim();
  if (v.length < MIN_TEXT) errors.push(`${label} debe tener al menos ${MIN_TEXT} caracteres.`);
  if (v.length > MAX_TEXT) errors.push(`${label} no puede superar ${MAX_TEXT.toLocaleString('es-CO')} caracteres.`);
  return v;
}

export interface CreateInput { text: string; channel: Channel; citizen: Citizen | null; anonymous: boolean; receivedAt?: string }

function parseCitizen(raw: unknown, errors: string[]): Citizen | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) {
    errors.push('«citizen» debe ser un objeto.');
    return null;
  }
  const c: Citizen = {};
  const str = (k: string, max: number): string | undefined => {
    const v = raw[k];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || v.trim().length > max) {
      errors.push(`«citizen.${k}» no es válido (máximo ${max} caracteres).`);
      return undefined;
    }
    return v.trim();
  };
  c.name = str('name', 120);
  c.email = str('email', 200);
  if (c.email && !EMAIL.test(c.email)) errors.push('El correo electrónico no es válido.');
  c.phone = str('phone', 20);
  if (c.phone && !/^\+?[\d\s-]{7,20}$/.test(c.phone)) errors.push('El teléfono no es válido.');
  c.documentId = str('documentId', 20);
  if (c.documentId && !/^[A-Za-z0-9.-]{4,20}$/.test(c.documentId)) errors.push('El documento de identidad no es válido.');
  const clean = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as Citizen;
  return Object.keys(clean).length ? clean : null;
}

export function parseCreate(raw: unknown): CreateInput {
  const o = body(raw);
  const errors: string[] = [];
  const text = textField(o, errors);
  let channel: Channel = 'web';
  if (o.channel !== undefined) {
    if (oneOf(CHANNELS, o.channel)) channel = o.channel;
    else errors.push(`«channel» debe ser uno de: ${CHANNELS.join(', ')}.`);
  }
  if (o.anonymous !== undefined && typeof o.anonymous !== 'boolean') errors.push('«anonymous» debe ser verdadero o falso.');
  const anonymous = o.anonymous === true;
  if (o.consent !== true) errors.push('Debes aceptar el tratamiento de tus datos personales (Ley 1581 de 2012) para radicar.');
  const citizen = anonymous ? null : parseCitizen(o.citizen, errors);
  if (errors.length) throw new ValidationError(errors);
  return { text, channel, citizen, anonymous };
}

export function parsePreview(raw: unknown): { text: string } {
  const errors: string[] = [];
  const text = textField(body(raw), errors);
  if (errors.length) throw new ValidationError(errors);
  return { text };
}

export interface ReclassifyInput { type?: PqrsdType; subtype?: Subtype; dependency?: string; urgency?: Urgency; note?: string }

export function parseReclassify(raw: unknown): ReclassifyInput {
  const o = body(raw);
  const errors: string[] = [];
  const out: ReclassifyInput = {};
  if (o.type !== undefined) (oneOf(PQRSD_TYPES, o.type) ? (out.type = o.type) : errors.push(`«type» debe ser uno de: ${PQRSD_TYPES.join(', ')}.`));
  if (o.subtype !== undefined) (oneOf(SUBTYPES, o.subtype) ? (out.subtype = o.subtype) : errors.push(`«subtype» debe ser uno de: ${SUBTYPES.join(', ')}.`));
  if (o.urgency !== undefined) (oneOf(URGENCIES, o.urgency) ? (out.urgency = o.urgency) : errors.push(`«urgency» debe ser uno de: ${URGENCIES.join(', ')}.`));
  if (o.dependency !== undefined) (typeof o.dependency === 'string' && /^[a-z0-9_]{2,64}$/.test(o.dependency) ? (out.dependency = o.dependency) : errors.push('«dependency» no es válida.'));
  if (o.note !== undefined) (typeof o.note === 'string' && o.note.length <= 500 ? (out.note = o.note.trim()) : errors.push('«note» debe ser texto de máximo 500 caracteres.'));
  if (!errors.length && out.type === undefined && out.subtype === undefined && out.urgency === undefined && out.dependency === undefined) errors.push('Indica al menos un campo a corregir: type, subtype, dependency o urgency.');
  if (errors.length) throw new ValidationError(errors);
  return out;
}

export function parseNote(raw: unknown): { note?: string } {
  if (raw === undefined || raw === null) return {};
  const o = body(raw);
  if (o.note === undefined) return {};
  if (typeof o.note !== 'string' || o.note.length > 500) throw new ValidationError(['«note» debe ser texto de máximo 500 caracteres.']);
  return { note: o.note.trim() };
}

export function parseAnswer(raw: unknown): { response: string } {
  const o = body(raw);
  const r = o.response;
  if (typeof r !== 'string' || r.trim().length < 10) throw new ValidationError(['La respuesta debe tener al menos 10 caracteres.']);
  if (r.trim().length > 5000) throw new ValidationError(['La respuesta no puede superar 5.000 caracteres.']);
  return { response: r.trim() };
}

export interface ImportInput { items: Array<{ text: string; receivedAt?: string }>; isDemo: boolean }

export function parseImport(raw: unknown): ImportInput {
  const o = body(raw);
  if (!Array.isArray(o.items) || o.items.length === 0) throw new ValidationError(['«items» debe ser una lista con al menos un elemento.']);
  if (o.items.length > MAX_IMPORT) throw new ValidationError([`Máximo ${MAX_IMPORT.toLocaleString('es-CO')} elementos por importación.`]);
  const errors: string[] = [];
  const items = o.items.map((it, i) => {
    if (!isObj(it) || typeof it.text !== 'string') {
      errors.push(`Elemento ${i + 1}: falta «text».`);
      return { text: '' };
    }
    const text = it.text.replace(/\u0000/g, '').trim().slice(0, MAX_TEXT);
    if (text.length < MIN_TEXT) errors.push(`Elemento ${i + 1}: el texto es demasiado corto.`);
    let receivedAt: string | undefined;
    if (it.receivedAt !== undefined) {
      const d = typeof it.receivedAt === 'string' ? new Date(it.receivedAt) : null;
      if (!d || Number.isNaN(d.getTime())) errors.push(`Elemento ${i + 1}: «receivedAt» no es una fecha ISO válida.`);
      else receivedAt = d.toISOString();
    }
    return { text, receivedAt };
  });
  if (errors.length) throw new ValidationError(errors.slice(0, 20));
  return { items, isDemo: o.isDemo !== false };
}

export function parseSeed(raw: unknown): { count: number } {
  if (raw === undefined || raw === null || (isObj(raw) && raw.count === undefined)) return { count: 60 };
  const o = body(raw);
  const n = Number(o.count);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new ValidationError(['«count» debe ser un entero entre 1 y 500.']);
  return { count: n };
}

export type SortKey = 'priority:desc' | 'dueDate:asc' | 'receivedAt:desc';

export interface ListQuery {
  status?: Status;
  type?: PqrsdType;
  dependency?: string;
  urgency?: Urgency;
  sla?: SlaStatus;
  needsReview?: boolean;
  isDemo?: boolean;
  q?: string;
  sort: SortKey;
  limit: number;
  offset: number;
}

export function parseListQuery(raw: Record<string, unknown>): ListQuery {
  const errors: string[] = [];
  const q: ListQuery = { sort: 'priority:desc', limit: 50, offset: 0 };
  const s = (k: string): string | undefined => (typeof raw[k] === 'string' && raw[k] !== '' ? (raw[k] as string) : undefined);
  const enumField = <T extends string>(k: string, list: readonly T[]): T | undefined => {
    const v = s(k);
    if (v === undefined) return undefined;
    if (oneOf(list, v)) return v;
    errors.push(`«${k}» debe ser uno de: ${list.join(', ')}.`);
    return undefined;
  };
  q.status = enumField('status', STATUSES);
  q.type = enumField('type', PQRSD_TYPES);
  q.urgency = enumField('urgency', URGENCIES);
  q.sla = enumField('sla', SLA_STATUSES);
  const dep = s('dependency');
  if (dep !== undefined) (/^[a-z0-9_]{2,64}$/.test(dep) ? (q.dependency = dep) : errors.push('«dependency» no es válida.'));
  const bool = (k: string): boolean | undefined => {
    const v = s(k);
    if (v === undefined) return undefined;
    if (v === 'true') return true;
    if (v === 'false') return false;
    errors.push(`«${k}» debe ser true o false.`);
    return undefined;
  };
  q.needsReview = bool('needsReview');
  q.isDemo = bool('isDemo');
  const text = s('q');
  if (text) q.q = text.slice(0, 100);
  const sort = s('sort');
  if (sort !== undefined) (['priority:desc', 'dueDate:asc', 'receivedAt:desc'].includes(sort) ? (q.sort = sort as SortKey) : errors.push('«sort» no es válido.'));
  const num = (k: string, min: number, max: number, def: number): number => {
    const v = s(k);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`«${k}» debe ser un entero entre ${min} y ${max}.`);
      return def;
    }
    return n;
  };
  q.limit = num('limit', 1, 200, 50);
  q.offset = num('offset', 0, 10_000_000, 0);
  if (errors.length) throw new ValidationError(errors);
  return q;
}
