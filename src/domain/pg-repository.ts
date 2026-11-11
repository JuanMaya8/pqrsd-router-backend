import type { PqrsdRepository } from './repository';
import type { PqrsdRecord } from './types';

/** The only thing the repository needs from a Postgres driver (a `pg.Pool` satisfies it). Keeps `pg` out of the domain. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

/**
 * Schema migrations, applied in order and recorded in `pq_migrations`. Append new entries; never edit an applied one.
 * The whole record is kept as JSONB (the domain owns its shape); the columns next to it exist for indexes and constraints.
 */
export const MIGRATIONS: ReadonlyArray<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS pq_counters (
        year  INTEGER PRIMARY KEY,
        value INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pq_cases (
        id          TEXT PRIMARY KEY,
        radicado    TEXT NOT NULL UNIQUE,
        received_at TIMESTAMPTZ NOT NULL,
        status      TEXT NOT NULL,
        is_demo     BOOLEAN NOT NULL DEFAULT FALSE,
        data        JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS pq_cases_received_at_idx ON pq_cases (received_at DESC);
      CREATE INDEX IF NOT EXISTS pq_cases_status_idx ON pq_cases (status);
      CREATE INDEX IF NOT EXISTS pq_cases_is_demo_idx ON pq_cases (is_demo) WHERE is_demo;
    `,
  },
];

/**
 * Applies pending migrations inside one transaction, guarded by an advisory lock so two replicas booting together do not race.
 * `db` must be ONE connection (`await pool.connect()`), not a pool: BEGIN/COMMIT have to run on the same session.
 */
export async function migrate(db: SqlClient): Promise<number[]> {
  const applied: number[] = [];
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(726173)');
    await db.query('CREATE TABLE IF NOT EXISTS pq_migrations (id INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await db.query<{ id: number }>('SELECT id FROM pq_migrations')).rows.map((r) => Number(r.id)));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await db.query(m.sql);
      await db.query('INSERT INTO pq_migrations (id) VALUES ($1)', [m.id]);
      applied.push(m.id);
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  return applied;
}

const RADICADO_PARTS = /^PQRSD-(\d{4})-(\d{6})$/;
const parse = (data: unknown): PqrsdRecord => (typeof data === 'string' ? (JSON.parse(data) as PqrsdRecord) : (data as PqrsdRecord));
const row = (r: PqrsdRecord): unknown[] => [r.id, r.radicado, r.receivedAt, r.status, r.isDemo, JSON.stringify(r)];

/**
 * PostgreSQL implementation of `PqrsdRepository`.
 *  - `reserve` is one atomic UPSERT, so the radicado sequence is safe with several replicas (unlike the file store).
 *  - `get` / `findByRadicado` use the primary key / unique index.
 *  - `all()` still loads every case: the list/stats code filters in memory (see AI_CONTEXT «No hecho» for pushing filters to SQL).
 */
export class PgPqrsdRepository implements PqrsdRepository {
  constructor(private readonly db: SqlClient) {}

  async reserve(year: number, n: number): Promise<number> {
    // the counter can never be behind the radicados already stored (e.g. data imported from the file store)
    const res = await this.db.query<{ value: number }>(
      `INSERT INTO pq_counters (year, value)
         VALUES ($1, COALESCE((SELECT MAX(CAST(SUBSTRING(radicado FROM 12) AS INTEGER)) FROM pq_cases WHERE radicado LIKE $3), 0) + $2)
       ON CONFLICT (year) DO UPDATE SET value = pq_counters.value + $2
       RETURNING value`,
      [year, n, `PQRSD-${year}-%`],
    );
    return Number(res.rows[0].value) - n + 1;
  }

  async insert(rec: PqrsdRecord): Promise<void> {
    await this.db.query('INSERT INTO pq_cases (id, radicado, received_at, status, is_demo, data) VALUES ($1, $2, $3, $4, $5, $6)', row(rec));
  }

  async insertMany(recs: PqrsdRecord[]): Promise<void> {
    const BATCH = 200;
    for (let i = 0; i < recs.length; i += BATCH) {
      const chunk = recs.slice(i, i + BATCH);
      const values = chunk.map((_, j) => `($${j * 6 + 1}, $${j * 6 + 2}, $${j * 6 + 3}, $${j * 6 + 4}, $${j * 6 + 5}, $${j * 6 + 6})`).join(', ');
      // ON CONFLICT: seedDemo inserts records it may already have saved (same contract as the file store: last write wins)
      await this.db.query(
        `INSERT INTO pq_cases (id, radicado, received_at, status, is_demo, data) VALUES ${values}
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
        chunk.flatMap(row),
      );
    }
  }

  async update(rec: PqrsdRecord): Promise<void> {
    await this.db.query('UPDATE pq_cases SET status = $2, data = $3, updated_at = now() WHERE id = $1', [rec.id, rec.status, JSON.stringify(rec)]);
  }

  async get(id: string): Promise<PqrsdRecord | null> {
    const res = await this.db.query<{ data: unknown }>('SELECT data FROM pq_cases WHERE id = $1', [id]);
    return res.rows[0] ? parse(res.rows[0].data) : null;
  }

  async findByRadicado(radicado: string): Promise<PqrsdRecord | null> {
    if (!RADICADO_PARTS.test(radicado)) return null;
    const res = await this.db.query<{ data: unknown }>('SELECT data FROM pq_cases WHERE radicado = $1', [radicado]);
    return res.rows[0] ? parse(res.rows[0].data) : null;
  }

  async all(): Promise<PqrsdRecord[]> {
    const res = await this.db.query<{ data: unknown }>('SELECT data FROM pq_cases ORDER BY received_at');
    return res.rows.map((r) => parse(r.data));
  }

  async removeWhere(pred: (r: PqrsdRecord) => boolean): Promise<number> {
    const ids = (await this.all()).filter(pred).map((r) => r.id);
    if (!ids.length) return 0;
    const res = await this.db.query('DELETE FROM pq_cases WHERE id = ANY($1::text[])', [ids]);
    return res.rowCount ?? ids.length;
  }
}
