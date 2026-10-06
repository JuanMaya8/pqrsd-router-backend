/**
 * Colombian business-day calendar (Ley 51 de 1983 «Ley Emiliani»). Pure date-string arithmetic in `YYYY-MM-DD`
 * (America/Bogota has no DST, so civil dates are enough). Every function is side-effect free.
 *
 * Holiday kinds:
 *  - fixed: 1 Jan, 1 May, 20 Jul, 7 Aug, 8 Dec, 25 Dec
 *  - moved to the following Monday (if not already Monday): 6 Jan, 19 Mar, 29 Jun, 15 Aug, 12 Oct, 1 Nov, 11 Nov
 *  - Easter-based: Holy Thursday (E-3) and Good Friday (E-2) fixed; Ascension (E+39), Corpus Christi (E+60) and
 *    Sacred Heart (E+68) moved to the following Monday.
 */

export type DateStr = string;

const MS_DAY = 86_400_000;

export function parseDate(s: DateStr): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Fecha inválida: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function fmtDate(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: DateStr, n: number): DateStr {
  return fmtDate(new Date(parseDate(s).getTime() + n * MS_DAY));
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(s: DateStr): number {
  return parseDate(s).getUTCDay();
}

/** Civil date in America/Bogota (UTC-5, no DST) for an instant. */
export function bogotaDate(instant: Date | string): DateStr {
  const t = typeof instant === 'string' ? new Date(instant) : instant;
  return fmtDate(new Date(t.getTime() - 5 * 3_600_000));
}

/** Gregorian Easter (Meeus/Jones/Butcher). */
export function easter(year: number): DateStr {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fmtDate(new Date(Date.UTC(year, month - 1, day)));
}

function toNextMonday(s: DateStr): DateStr {
  const dow = dayOfWeek(s);
  return dow === 1 ? s : addDays(s, (8 - dow) % 7);
}

const cache = new Map<number, Map<DateStr, string>>();

/** date → name, for one year. */
export function holidays(year: number): Map<DateStr, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Map<DateStr, string>();
  const y = String(year);
  const fixed: Array<[string, string]> = [['01-01', 'Año Nuevo'], ['05-01', 'Día del Trabajo'], ['07-20', 'Día de la Independencia'], ['08-07', 'Batalla de Boyacá'], ['12-08', 'Inmaculada Concepción'], ['12-25', 'Navidad']];
  for (const [md, name] of fixed) out.set(`${y}-${md}`, name);
  const emiliani: Array<[string, string]> = [['01-06', 'Reyes Magos'], ['03-19', 'San José'], ['06-29', 'San Pedro y San Pablo'], ['08-15', 'Asunción de la Virgen'], ['10-12', 'Día de la Raza'], ['11-01', 'Todos los Santos'], ['11-11', 'Independencia de Cartagena']];
  for (const [md, name] of emiliani) out.set(toNextMonday(`${y}-${md}`), name);
  const e = easter(year);
  out.set(addDays(e, -3), 'Jueves Santo');
  out.set(addDays(e, -2), 'Viernes Santo');
  out.set(toNextMonday(addDays(e, 39)), 'Ascensión del Señor');
  out.set(toNextMonday(addDays(e, 60)), 'Corpus Christi');
  out.set(toNextMonday(addDays(e, 68)), 'Sagrado Corazón');
  cache.set(year, out);
  return out;
}

export function holidayName(s: DateStr): string | null {
  return holidays(Number(s.slice(0, 4))).get(s) ?? null;
}

export function isBusinessDay(s: DateStr): boolean {
  const dow = dayOfWeek(s);
  return dow !== 0 && dow !== 6 && holidayName(s) === null;
}

/** `s` itself if it is a business day, otherwise the next one. */
export function nextBusinessDay(s: DateStr): DateStr {
  let d = s;
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/**
 * Date of the n-th business day AFTER `from` (day 1 = the first business day following `from`; `from` itself is never counted).
 * n = 0 returns `from`.
 */
export function addBusinessDays(from: DateStr, n: number): DateStr {
  if (!Number.isInteger(n) || n < 0) throw new Error('n debe ser un entero ≥ 0');
  let d = from;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) left -= 1;
  }
  return d;
}

/**
 * Signed number of business days from `from` to `to`: business days in (from, to] when to > from;
 * the negative count of business days in (to, from] when to < from; 0 when equal.
 */
export function businessDaysBetween(from: DateStr, to: DateStr): number {
  if (from === to) return 0;
  const forward = from < to;
  const [a, b] = forward ? [from, to] : [to, from];
  let count = 0;
  for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (isBusinessDay(d)) count += 1;
  return forward ? count : -count;
}
