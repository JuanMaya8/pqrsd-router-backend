/**
 * Boots the real Nest app with DATABASE_URL (migrations + PgPqrsdRepository) and checks that data survives an app restart.
 * Skipped unless TEST_DATABASE_URL is set (see test/pg-repository.test.ts).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import request from 'supertest';
import { buildApp } from '../../src/app.factory';
import { loadConfig } from '../../src/domain';
import { FakeAi, create } from '../helpers';

const url = process.env.TEST_DATABASE_URL;
const schema = `pq_e2e_${process.pid}_${Date.now()}`;
const API = '/api/v1';
const KEY = { 'X-Staff-Key': 'k' };

before(async () => {
  if (!url) return;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
});
after(async () => {
  if (!url) return;
  const admin = new Pool({ connectionString: url });
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function boot() {
  const dbUrl = new URL(url!);
  dbUrl.searchParams.set('options', `-c search_path=${schema}`);
  const config = loadConfig({ DATABASE_URL: dbUrl.toString(), AI_URL: 'http://ai.test', STAFF_API_KEY: 'k', THROTTLE_LIMIT: '1000' });
  const app = await buildApp(config, { fetchImpl: new FakeAi().fetch, swagger: false });
  await app.listen(0, '127.0.0.1');
  return { app, base: await app.getUrl() };
}

test('the app runs on Postgres and keeps cases across restarts', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const first = await boot();
  let radicado: string;
  let code: string;
  try {
    assert.equal((await request(first.base).get(`${API}/health`).expect(200)).body.store, 'postgres');
    const r = await request(first.base).post(`${API}/pqrsd`).send(create()).expect(201);
    radicado = r.body.radicado;
    code = r.body.trackingCode;
  } finally {
    await first.app.close();
  }
  const second = await boot();
  try {
    const t = await request(second.base).get(`${API}/public/tracking/${radicado}`).query({ code }).expect(200);
    assert.equal(t.body.radicado, radicado);
    const r2 = await request(second.base).post(`${API}/pqrsd`).send(create()).expect(201);
    assert.ok(r2.body.radicado.endsWith('000002'));
    assert.equal((await request(second.base).get(`${API}/staff/pqrsd`).set(KEY).expect(200)).body.total, 2);
  } finally {
    await second.app.close();
  }
});
