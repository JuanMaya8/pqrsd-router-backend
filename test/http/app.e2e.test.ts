/**
 * HTTP + WebSocket tests against the real Nest app, with a fake AI service injected.
 * STATUS: written but NOT executed in the environment where this repo was created (npm registry blocked, Nest not installable).
 * Run with: npm run test:http   — if something fails here, fix it first (see AI_CONTEXT.md).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { buildApp } from '../../src/app.factory';
import { loadConfig } from '../../src/domain';
import { FakeAi, create } from '../helpers';

const ai = new FakeAi();
const dir = mkdtempSync(join(tmpdir(), 'pq-e2e-'));
let app: NestExpressApplication;
let base: string;
const API = '/api/v1';
const KEY = { 'X-Staff-Key': 'staff-test' };

before(async () => {
  const config = loadConfig({ DATA_DIR: dir, AI_URL: 'http://ai.test', CORS_ORIGINS: 'http://localhost:3000', STAFF_API_KEY: 'staff-test', THROTTLE_LIMIT: '1000', PUBLIC_WRITE_LIMIT: '30' });
  app = await buildApp(config, { fetchImpl: ai.fetch, swagger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('health reports the AI as up and down', async () => {
  const up = await request(base).get(`${API}/health`).expect(200);
  assert.equal(up.body.ai.available, true);
  ai.down = true;
  assert.equal((await request(base).get(`${API}/health`).expect(200)).body.ai.available, false);
  ai.down = false;
});

test('citizen flow: preview → create → public tracking; error shape is Spanish and uniform', async () => {
  const p = await request(base).post(`${API}/pqrsd/preview`).send({ text: 'No llega el agua a mi barrio hace tres semanas.' }).expect(200);
  assert.equal(p.body.classification.dependency.id, 'servicios_publicos');

  const bad = await request(base).post(`${API}/pqrsd`).send({ text: 'corto', consent: false }).expect(400);
  assert.equal(bad.body.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(bad.body.details));

  const r = await request(base).post(`${API}/pqrsd`).send(create({ citizen: { name: 'Ana', email: 'ana@x.co' } })).expect(201);
  assert.match(r.body.radicado, /^PQRSD-\d{4}-\d{6}$/);

  const t = await request(base).get(`${API}/public/tracking/${r.body.radicado}`).query({ code: r.body.trackingCode }).expect(200);
  assert.equal(t.body.status, 'pending_review');
  assert.ok(!JSON.stringify(t.body).includes('ana@x.co'));
  assert.equal(t.headers['cache-control'], 'no-store');
  await request(base).get(`${API}/public/tracking/${r.body.radicado}`).query({ code: 'AAAAAA' }).expect(404);
  await request(base).get(`${API}/public/tracking/${r.body.radicado}`).expect(404);

  const badJson = await request(base).post(`${API}/pqrsd`).set('Content-Type', 'application/json').send('{no es json').expect(400);
  assert.equal(badJson.body.code, 'INVALID_JSON');
  await request(base).get(`${API}/nope`).expect(404);
});

test('staff routes need X-Staff-Key (reads too: they contain personal data)', async () => {
  await request(base).get(`${API}/staff/pqrsd`).expect(401);
  const wrong = await request(base).get(`${API}/staff/pqrsd`).set('X-Staff-Key', 'nope').expect(401);
  assert.equal(wrong.body.code, 'UNAUTHORIZED');
  await request(base).get(`${API}/staff/stats`).expect(401);
  await request(base).get(`${API}/staff/pqrsd`).set(KEY).expect(200);
});

test('staff workflow over HTTP: list → detail → reclassify → answer → close, plus csv', async () => {
  const r = await request(base).post(`${API}/pqrsd`).send(create({ text: 'Solicito copia del contrato de obra del parque del barrio Santa Lucía.' })).expect(201);
  const list = await request(base).get(`${API}/staff/pqrsd`).set(KEY).query({ q: 'contrato', sort: 'receivedAt:desc' }).expect(200);
  const id = list.body.items[0].id as string;
  assert.equal(list.body.items[0].radicado, r.body.radicado);
  const detail = await request(base).get(`${API}/staff/pqrsd/${id}`).set(KEY).expect(200);
  assert.ok(detail.body.text.includes('contrato'));

  await request(base).post(`${API}/staff/pqrsd/${id}/close`).set(KEY).expect(409);
  const re = await request(base).post(`${API}/staff/pqrsd/${id}/reclassify`).set(KEY).send({ dependency: 'hacienda', urgency: 'high' }).expect(200);
  assert.equal(re.body.dependency.id, 'hacienda');
  await request(base).post(`${API}/staff/pqrsd/${id}/reclassify`).set(KEY).send({}).expect(400);
  await request(base).post(`${API}/staff/pqrsd/${id}/answer`).set(KEY).send({ response: 'Adjuntamos la copia solicitada.' }).expect(200);
  const closed = await request(base).post(`${API}/staff/pqrsd/${id}/close`).set(KEY).expect(200);
  assert.equal(closed.body.status, 'closed');
  await request(base).get(`${API}/staff/pqrsd/pq_000000000000`).set(KEY).expect(404);

  const csv = await request(base).get(`${API}/staff/export.csv`).set(KEY).expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /attachment/);
  assert.ok(csv.text.startsWith('﻿Radicado'));
  await request(base).get(`${API}/staff/export.csv`).expect(401);
});

test('stats, transparency, demo seed/delete, AI admin', async () => {
  await request(base).post(`${API}/staff/demo/seed`).set(KEY).send({ count: 20 }).expect(200);
  const stats = await request(base).get(`${API}/staff/stats`).set(KEY).expect(200);
  assert.ok(stats.body.totals.all >= 20);
  const pub = await request(base).get(`${API}/public/transparency`).expect(200);
  assert.equal(pub.body.includesDemo, true);
  assert.equal(pub.body.weekly.length, 12);
  const del = await request(base).delete(`${API}/staff/demo`).set(KEY).expect(200);
  assert.ok(del.body.deleted >= 20);
  const st = await request(base).get(`${API}/staff/ai/status`).set(KEY).expect(200);
  assert.equal(st.body.available, true);
  await request(base).post(`${API}/staff/ai/retrain`).set(KEY).expect(200);
  assert.equal(ai.retrains, 1);
  const tax = await request(base).get(`${API}/meta/taxonomy`).expect(200);
  assert.ok(tax.body.dependencies.length >= 12);
});

test('import over HTTP and AI-down fallback for the citizen', async () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ text: `Solicito copia del acta número ${i} de la reunión del concejo.` }));
  const imp = await request(base).post(`${API}/staff/import`).set(KEY).send({ items }).expect(200);
  assert.equal(imp.body.imported, 30);
  ai.down = true;
  const r = await request(base).post(`${API}/pqrsd`).send(create({ text: 'Hay una fuga de gas en mi edificio, es una emergencia.' })).expect(201);
  assert.equal(r.body.dependency.id, 'atencion_ciudadano');
  ai.down = false;
});

test('public writes are rate limited per IP', async () => {
  const limited = await buildApp(loadConfig({ DATA_DIR: join(dir, 'rl'), AI_URL: 'http://ai.test', STAFF_API_KEY: 'k', PUBLIC_WRITE_LIMIT: '3', THROTTLE_LIMIT: '1000' }), { fetchImpl: ai.fetch, swagger: false });
  await limited.listen(0, '127.0.0.1');
  const url = await limited.getUrl();
  try {
    for (let i = 0; i < 3; i += 1) await request(url).post(`${API}/pqrsd/preview`).send({ text: 'Texto de prueba suficientemente largo.' }).expect(200);
    const res = await request(url).post(`${API}/pqrsd/preview`).send({ text: 'Texto de prueba suficientemente largo.' }).expect(429);
    assert.equal(res.body.code, 'TOO_MANY_REQUESTS');
    await request(url).get(`${API}/health`).expect(200); // reads are not affected
  } finally {
    await limited.close();
  }
});

function connect(auth?: Record<string, string>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`${base}/realtime`, { auth, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const nextEvent = (s: Socket, event: string, ms = 1500): Promise<any> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    s.once(event, (p: unknown) => { clearTimeout(t); resolve(p); });
  });

test('socket.io: staff get case events, the public room only gets «stats.changed», and no payload has personal data', async () => {
  const staff = await connect({ staffKey: 'staff-test' });
  const pub = await connect();
  try {
    const created = nextEvent(staff, 'pqrsd.created');
    const stats = nextEvent(pub, 'stats.changed');
    const publicCreated = nextEvent(pub, 'pqrsd.created', 600);
    await request(base).post(`${API}/pqrsd`).send(create({ citizen: { name: 'Ana Pérez', email: 'ana@x.co' } })).expect(201);
    const c = await created;
    assert.ok(c && /^PQRSD-/.test(c.radicado));
    assert.ok(!JSON.stringify(c).includes('Ana'));
    assert.ok(await stats);
    assert.equal(await publicCreated, null);
  } finally {
    staff.close();
    pub.close();
  }
});
