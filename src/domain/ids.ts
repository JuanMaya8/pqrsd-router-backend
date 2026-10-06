import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const TRACKING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: easy to read over the phone

export const newId = (): string => `pq_${randomBytes(6).toString('hex')}`;
export const ID_RE = /^pq_[0-9a-f]{12}$/;

export function newTrackingCode(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  return out;
}

export const formatRadicado = (year: number, seq: number): string => `PQRSD-${year}-${String(seq).padStart(6, '0')}`;
export const RADICADO_RE = /^PQRSD-\d{4}-\d{6}$/;

export function codesMatch(stored: string, sent: string): boolean {
  const a = Buffer.from(stored.toUpperCase());
  const b = Buffer.from(sent.trim().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
