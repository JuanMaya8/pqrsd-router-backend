/**
 * PgPqrsdRepository against a REAL PostgreSQL. Skipped unless TEST_DATABASE_URL is set, e.g.:
 *   docker run -d --name pqrsd-pg-test -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=pqrsd -p 55432:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:pg@localhost:55432/pqrsd npm test
 * Every run uses its own schema, dropped at the end.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { migrate, PgPqrsdRepository } from '../src/domain';
import { create, harness } from './helpers';

const url = process.env.TEST_DATABASE_URL;
const schema = `pq_test_${process.pid}_${Date.now()}`;
let pool: Pool;

before(async () => {
  if (!url) return;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
});
after(async () => {
  if (!url) return;
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

test('migrations apply once and are idempotent', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  assert.deepEqual(await withClient(migrate), [1]);
  assert.deepEqual(await withClient(migrate), []);
});

test('the full service works on Postgres and survives a «restart»', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const h = harness({ repo: new PgPqrsdRepository(pool) });
  const r1 = await h.service.create(create({ citizen: { name: 'Ana', email: 'ana@correo.co' } }));
  const r2 = await h.service.create(create());
  assert.ok(r2.radicado.endsWith('000002'));
  const id = (await h.service.list({ q: r1.radicado })).items[0].id;
  await h.service.assign(id, { assignee: 'María Gómez' });
  await h.service.extend(id, { days: 4, reason: 'Se requiere un concepto técnico adicional.' });

  const repo2 = new PgPqrsdRepository(pool);
  const back = await repo2.get(id);
  assert.equal(back?.assignee, 'María Gómez');
  assert.equal(back?.extension?.days, 4);
  assert.equal(back?.citizen?.email, 'ana@correo.co');
  assert.equal((await repo2.findByRadicado(r1.radicado))?.trackingCode, r1.trackingCode);
  assert.equal(await repo2.findByRadicado('nope'), null);
  assert.equal((await h.service.tracking(r1.radicado, r1.trackingCode)).status, 'assigned');

  await h.service.seedDemo({ count: 25 }, 11);
  assert.equal((await h.service.stats()).totals.all, 27);
  assert.equal((await h.service.deleteDemo()).deleted, 25);
  assert.equal((await repo2.all()).length, 2);
  await h.service.importMany({ items: Array.from({ length: 450 }, (_, i) => ({ text: `Solicito copia del acta número ${i} del concejo.` })) });
  assert.equal((await repo2.all()).length, 452);
});

test('reserve is atomic across concurrent callers (several replicas) and never behind stored radicados', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const a = new PgPqrsdRepository(pool);
  const b = new PgPqrsdRepository(pool);
  const firsts = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).reserve(2031, 3)));
  const taken = firsts.flatMap((f) => [f, f + 1, f + 2]).sort((x, y) => x - y);
  assert.deepEqual(taken, Array.from({ length: 60 }, (_, i) => i + 1));

  // a radicado imported «by hand» ahead of an empty counter
  const rec = (await a.all())[0];
  await a.insert({ ...rec, id: 'pq_aaaaaaaaaaaa', radicado: 'PQRSD-2032-000040' });
  assert.equal(await a.reserve(2032, 1), 41);
});
