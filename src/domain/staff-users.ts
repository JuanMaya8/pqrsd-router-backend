import { timingSafeEqual } from 'node:crypto';

/** A named staff account: the key is what the person types in /funcionario, the name is written in the case history. */
export interface StaffUser {
  name: string;
  key: string;
}

/** Name used when no key is configured at all (development only: main.ts refuses to boot like that in production). */
export const DEV_STAFF_NAME = 'Funcionario (desarrollo)';
/** Name used for the shared STAFF_API_KEY. */
export const SHARED_STAFF_NAME = 'Funcionario';

/**
 * Parses `STAFF_USERS="Ana Pérez:clave-ana,Luis Ruiz:clave-luis"`. The key is what follows the LAST «:».
 * Throws on malformed entries so a typo is seen at boot instead of locking someone out.
 */
export function parseStaffUsers(raw: string | undefined): StaffUser[] {
  if (!raw || !raw.trim()) return [];
  const users: StaffUser[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = entry.lastIndexOf(':');
    const name = i > 0 ? entry.slice(0, i).trim().replace(/\s+/g, ' ') : '';
    const key = i > 0 ? entry.slice(i + 1).trim() : '';
    if (name.length < 3 || key.length < 8) throw new Error(`STAFF_USERS: «${entry.slice(0, 40)}» debe tener la forma «Nombre:clave» (nombre de 3+ caracteres y clave de 8+).`);
    if (users.some((u) => u.key === key)) throw new Error(`STAFF_USERS: la clave de «${name}» está repetida.`);
    users.push({ name, key });
  }
  return users;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Who is behind a staff key: the user's name, «Funcionario» for the shared key, the development name when nothing is configured,
 * or null when the key is wrong.
 */
export function resolveStaff(auth: { staffKey?: string; staffUsers: StaffUser[] }, sent: unknown): string | null {
  if (!auth.staffKey && auth.staffUsers.length === 0) return DEV_STAFF_NAME;
  const key = typeof sent === 'string' ? sent : '';
  if (!key) return null;
  let found: string | null = null;
  for (const u of auth.staffUsers) if (same(u.key, key)) found = u.name; // no early exit: same work for every key
  if (!found && auth.staffKey && same(auth.staffKey, key)) found = SHARED_STAFF_NAME;
  return found;
}
