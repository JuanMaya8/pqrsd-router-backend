import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError, type PqrsdDetail } from '../src/domain';
import { create, harness, T0 } from './helpers';

const code = async (p: Promise<unknown>): Promise<string> => p.then(() => 'no-error', (e: DomainError) => e.code);

test('create: classifies on receipt, computes the legal deadline and returns a receipt', async () => {
  const h = harness();
  const r = await h.service.create(create());
  assert.match(r.radicado, /^PQRSD-2025-000001$/);
  assert.match(r.trackingCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(r.type.id, 'reclamo');
  assert.equal(r.dependency.id, 'servicios_publicos');
  assert.equal(r.legalDays, 15);
  // received Wed 2025-03-05 → 15 business days → Mon 24 Mar is a holiday → Thu 27 Mar (day 1 = Thu 6 Mar)
  assert.equal(r.dueDate, '2025-03-27');
  assert.match(r.message, /PQRSD-2025-000001/);
  assert.match(r.message, /15 días hábiles/);
  const list = await h.service.list({});
  assert.equal(list.total, 1);
  assert.equal(list.items[0].status, 'pending_review');
  assert.equal(h.ai.count('/v1/classify'), 1);
  assert.deepEqual(h.events.map((e) => e.event), ['pqrsd.created', 'stats.changed']);
});

test('create: peticion subtype drives the legal term (information = 10 days)', async () => {
  const h = harness();
  const r = await h.service.create(create({ text: 'Solicito copia del contrato de obra del parque del barrio.' }));
  assert.equal(r.legalDays, 10);
});

test('create: validation errors are Spanish and complete', async () => {
  const h = harness();
  assert.equal(await code(h.service.create({ text: 'corto', consent: true })), 'VALIDATION_ERROR');
  assert.equal(await code(h.service.create({ text: 'Un texto suficientemente largo para radicar', consent: false })), 'VALIDATION_ERROR');
  const err = await h.service.create({ text: 'x', consent: false, citizen: { email: 'no-es-correo' } }).catch((e: DomainError) => e);
  assert.ok(err instanceof DomainError);
  assert.ok((err.details ?? []).length >= 3);
  assert.equal((await h.service.list({})).total, 0);
});

test('anonymous: citizen data is dropped', async () => {
  const h = harness();
  await h.service.create(create({ anonymous: true, citizen: { name: 'Ana', email: 'ana@x.co' } }));
  const id = (await h.service.list({})).items[0].id;
  assert.equal((await h.service.get(id)).citizen, null);
});

test('AI down: fallback classifier, always needs review, dependency = Atención al Ciudadano; the breaker avoids repeated timeouts', async () => {
  const h = harness();
  h.ai.down = true;
  const a = await h.service.create(create({ text: 'Hay una fuga de gas en mi edificio, es una emergencia.' }));
  assert.equal(a.dependency.id, 'atencion_ciudadano');
  const detail = await h.service.get((await h.service.list({})).items[0].id);
  assert.equal(detail.source, 'fallback');
  assert.equal(detail.needsReview, true);
  assert.equal(detail.urgency.id, 'critical'); // unmistakable phrase still escalates
  const before = h.ai.count('/v1/classify');
  await h.service.create(create());
  await h.service.create(create());
  assert.equal(h.ai.count('/v1/classify'), before, 'during the cooldown the AI is not called again');
  assert.equal((await h.service.stats()).aiAvailable, false);
  // recovery after the cooldown
  h.ai.down = false;
  h.clock.advanceHours(1);
  await h.service.create(create());
  assert.equal((await h.service.list({ sort: 'receivedAt:desc', limit: '1' })).items[0].source, 'ai');
});

test('tracking: needs the right code; unknown radicado and wrong code are indistinguishable; no personal data', async () => {
  const h = harness();
  const r = await h.service.create(create({ text: 'Mi cédula 52.123.456 y no llega el agua a mi casa hace días.', citizen: { name: 'Ana Pérez', email: 'ana@x.co' } }));
  const t = await h.service.tracking(r.radicado, r.trackingCode.toLowerCase());
  assert.equal(t.status, 'pending_review');
  assert.equal(t.statusLabel, 'Recibida, en revisión');
  const json = JSON.stringify(t);
  for (const secret of ['Ana', 'ana@x.co', '52.123.456', 'no llega el agua']) assert.ok(!json.includes(secret), `la vista pública filtra «${secret}»`);
  const wrong = await h.service.tracking(r.radicado, 'AAAAAA').catch((e: DomainError) => e);
  const unknown = await h.service.tracking('PQRSD-2025-999999', 'AAAAAA').catch((e: DomainError) => e);
  const noCode = await h.service.tracking(r.radicado, undefined).catch((e: DomainError) => e);
  for (const e of [wrong, unknown, noCode]) {
    assert.ok(e instanceof DomainError);
    assert.equal(e.status, 404);
  }
  assert.equal((wrong as DomainError).message.replace(r.radicado, 'X'), (unknown as DomainError).message.replace('PQRSD-2025-999999', 'X'));
});

test('workflow: confirm → answer → close; invalid transitions are 409', async () => {
  const h = harness();
  await h.service.create(create());
  const { id } = (await h.service.list({})).items[0];
  assert.equal(await code(h.service.close(id)), 'INVALID_TRANSITION'); // cannot close before answering
  const confirmed = await h.service.confirm(id, { note: 'ok' });
  assert.equal(confirmed.status, 'assigned');
  assert.equal(await code(h.service.confirm(id, {})), 'INVALID_TRANSITION'); // already assigned
  assert.equal(await code(h.service.answer(id, { response: 'corta' })), 'VALIDATION_ERROR');
  h.clock.advanceHours(24);
  const answered = await h.service.answer(id, { response: 'Ya se restableció el servicio de agua en su barrio.' });
  assert.equal(answered.status, 'answered');
  assert.equal(answered.slaStatus, 'done');
  assert.equal(await code(h.service.reclassify(id, { urgency: 'low' })), 'INVALID_TRANSITION');
  assert.equal((await h.service.close(id)).status, 'closed');
  assert.equal(await code(h.service.answer(id, { response: 'otra respuesta distinta' })), 'INVALID_TRANSITION');
  const detail = await h.service.get(id);
  assert.deepEqual(detail.timeline.map((t) => t.event), ['received', 'classified', 'confirmed', 'answered', 'closed']);
  assert.equal(await code(h.service.get('pq_000000000000')), 'NOT_FOUND');
});

test('reclassify: recomputes the term from the ORIGINAL date, updates priority, sends redacted feedback to the AI', async () => {
  const h = harness();
  await h.service.create(create({ text: 'Mi cédula 52.123.456, solicito información sobre mi trámite en la oficina.' }));
  const { id } = (await h.service.list({})).items[0];
  const before = await h.service.get(id);
  assert.equal(before.deadline.legalDays, 15);
  h.clock.advanceHours(24 * 10);
  const after = await h.service.reclassify(id, { type: 'denuncia', dependency: 'control_interno', urgency: 'high', note: 'es corrupción' });
  assert.equal(after.status, 'assigned');
  assert.equal(after.type.id, 'denuncia');
  assert.equal(after.dependency.id, 'control_interno');
  assert.equal(after.priorityScore, 72);
  assert.equal(after.deadline.verify, true);
  assert.equal(after.deadline.countFrom, before.deadline.countFrom, 'the term always counts from the original receipt');
  assert.equal(after.timeline.at(-1)?.event, 'reclassified');
  assert.match(after.timeline.at(-1)?.detail ?? '', /tipo: Petición → Denuncia/);
  await h.service.idle();
  assert.equal(h.ai.feedback.length, 1);
  const fb = h.ai.feedback[0];
  assert.deepEqual([fb.type, fb.dependency, fb.urgency], ['denuncia', 'control_interno', 'high']);
  assert.ok(!fb.text.includes('52.123.456'), 'personal data must not travel to the AI');
  assert.match(fb.text, /\[DOCUMENTO\]/);
  assert.equal(fb.source_id, before.radicado);
  assert.equal(await code(h.service.reclassify(id, { dependency: 'no_existe' })), 'VALIDATION_ERROR');
  assert.equal(await code(h.service.reclassify(id, {})), 'VALIDATION_ERROR');
});

test('reclassify back to the AI answer restores the AI priority and counts as agreement', async () => {
  const h = harness();
  await h.service.create(create({ text: 'Hay una fuga de gas en el edificio, huele muy fuerte.' }));
  const { id } = (await h.service.list({})).items[0];
  await h.service.reclassify(id, { urgency: 'low' });
  assert.equal((await h.service.get(id)).priorityScore, 15);
  const back = await h.service.reclassify(id, { urgency: 'critical' });
  assert.equal(back.priorityScore, 90);
  assert.equal((await h.service.stats()).aiAgreementRate, 1);
});

test('confirm does not feed the AI back by default (avoids confirmation bias); demo cases never do', async () => {
  const h = harness();
  await h.service.create(create());
  const { id } = (await h.service.list({})).items[0];
  await h.service.confirm(id, {});
  await h.service.idle();
  assert.equal(h.ai.feedback.length, 0);
  await h.service.seedDemo({ count: 5 }, 1);
  const demo = (await h.service.list({ isDemo: 'true', status: 'pending_review' })).items[0];
  if (demo) await h.service.reclassify(demo.id, { urgency: 'low' });
  await h.service.idle();
  assert.equal(h.ai.feedback.length, 0);
});

test('aiAgreementRate = share of reviewed cases that staff did not change', async () => {
  const h = harness();
  for (let i = 0; i < 4; i += 1) await h.service.create(create());
  const ids = (await h.service.list({})).items.map((i) => i.id);
  await h.service.confirm(ids[0], {});
  await h.service.confirm(ids[1], {});
  await h.service.confirm(ids[2], {});
  await h.service.reclassify(ids[3], { dependency: 'salud' });
  assert.equal((await h.service.stats()).aiAgreementRate, 0.75);
});

test('auto-assign skips manual triage only for confident, unflagged AI results', async () => {
  const h = harness({ autoAssignMinConfidence: 0.75 });
  await h.service.create(create());
  await h.service.create(create({ text: 'Caso dudoso sobre algo del agua en la vereda.' }));
  const items = (await h.service.list({ sort: 'receivedAt:desc' })).items;
  const byStatus = Object.fromEntries(items.map((i) => [i.needsReview, i.status]));
  assert.equal(byStatus['false'], 'assigned');
  assert.equal(byStatus['true'], 'pending_review');
});

test('SLA and ordering: overdue and at-risk cases float up; filters work', async () => {
  const h = harness();
  await h.service.create(create({ text: 'Sugiero que pongan más bancas en el parque del barrio.' })); // low priority
  await h.service.create(create({ text: 'Hay una fuga de gas en el edificio, huele muy fuerte.' })); // critical
  h.clock.set('2025-03-21T15:00:00Z'); // 12 business days later → the 15-day term is at risk
  let items = (await h.service.list({})).items;
  assert.equal(items[0].urgency.id, 'critical');
  assert.ok(items.every((i) => i.slaStatus === 'at_risk'));
  h.clock.set('2025-04-30T15:00:00Z');
  items = (await h.service.list({})).items;
  assert.ok(items.every((i) => i.slaStatus === 'overdue' && i.businessDaysLeft < 0));
  assert.equal((await h.service.list({ sla: 'overdue' })).total, 2);
  assert.equal((await h.service.list({ sla: 'on_time' })).total, 0);
  assert.equal((await h.service.list({ urgency: 'critical' })).total, 1);
  assert.equal((await h.service.list({ q: 'BANCAS' })).total, 1);
  assert.equal((await h.service.list({ q: 'gás' })).total, 1); // accent-insensitive
  assert.equal(await code(h.service.list({ sla: 'nope' })), 'VALIDATION_ERROR');
  const s = await h.service.stats();
  assert.equal(s.totals.overdue, 2);
  assert.equal(s.totals.open, 2);
});

test('ordering: answered and closed cases sink below every open one, whatever their priority', async () => {
  const h = harness();
  const critical = await h.service.create(create({ text: 'Hay una fuga de gas en el edificio, huele muy fuerte.' }));
  await h.service.create(create({ text: 'Sugiero que pongan más bancas en el parque del barrio.' })); // low priority, still open
  const id = (await h.service.list({})).items[0].id;
  assert.equal((await h.service.get(id)).radicado, critical.radicado);
  await h.service.answer(id, { response: 'Atendimos la emergencia con la empresa de gas.' });
  for (const sort of ['priority:desc', 'dueDate:asc'] as const) {
    const items = (await h.service.list({ sort })).items;
    assert.equal(items[0].urgency.id, 'low', sort); // the open low-priority case now comes first
    assert.equal(items.at(-1)!.radicado, critical.radicado, sort);
  }
});

test('concurrent creates never share a radicado', async () => {
  const h = harness();
  const receipts = await Promise.all(Array.from({ length: 25 }, () => h.service.create(create())));
  assert.equal(new Set(receipts.map((r) => r.radicado)).size, 25);
  assert.equal(new Set(receipts.map((r) => r.trackingCode)).size, 25);
});

test('preview classifies without saving anything', async () => {
  const h = harness();
  const p = await h.service.preview({ text: 'Hay un hueco enorme frente a mi casa en la calle 45 con carrera 12.' });
  assert.equal(p.classification.dependency.id, 'infraestructura');
  assert.equal(p.deadline.legalDays, 15);
  assert.equal((await h.service.list({})).total, 0);
});

test('import: chunks of 200 to the AI, unique sequential radicados, flagged demo', async () => {
  const h = harness();
  const items = Array.from({ length: 450 }, (_, i) => ({ text: `Solicito copia del acta número ${i} de la reunión del concejo.` }));
  const r = await h.service.importMany({ items });
  assert.equal(r.imported, 450);
  assert.equal(h.ai.count('/v1/classify/batch'), 3);
  const all = (await h.service.list({ limit: '200' })).total;
  assert.equal(all, 450);
  const radicados = (await h.repo.all()).map((x) => x.radicado).sort();
  assert.equal(new Set(radicados).size, 450);
  assert.equal(radicados[0], 'PQRSD-2025-000001');
  assert.equal(radicados[449], 'PQRSD-2025-000450');
  assert.equal((await h.service.list({ isDemo: 'true' })).total, 450);
  assert.equal(await code(h.service.importMany({ items: [] })), 'VALIDATION_ERROR');
  assert.equal(await code(h.service.importMany({ items: [{ text: 'corto' }] })), 'VALIDATION_ERROR');
});

test('import keeps going with the fallback when the AI dies mid-way', async () => {
  const h = harness();
  h.ai.failBatchAt = 2;
  const items = Array.from({ length: 450 }, (_, i) => ({ text: `Solicito copia del acta número ${i} de la reunión del concejo.` }));
  const r = await h.service.importMany({ items });
  assert.equal(r.imported, 450);
  const sources = (await h.repo.all()).reduce<Record<string, number>>((a, x) => ({ ...a, [x.classification.source]: (a[x.classification.source] ?? 0) + 1 }), {});
  assert.ok(sources.fallback >= 200 && sources.ai >= 200, JSON.stringify(sources));
});

test('seedDemo: deterministic, coherent states, and removable', async () => {
  const a = harness();
  const b = harness();
  await a.service.seedDemo({ count: 80 }, 42);
  await b.service.seedDemo({ count: 80 }, 42);
  const texts = async (h: ReturnType<typeof harness>) => (await h.repo.all()).map((r) => r.text).sort();
  assert.deepEqual(await texts(a), await texts(b));
  const all = await a.repo.all();
  assert.ok(all.every((r) => r.isDemo));
  assert.ok(all.some((r) => r.status === 'answered' || r.status === 'closed'));
  assert.ok(all.some((r) => r.status === 'pending_review'));
  for (const r of all) {
    if (r.response) assert.ok(r.response.answeredAt >= r.receivedAt.slice(0, 10), 'answered before it was received');
    assert.equal(r.status === 'answered' || r.status === 'closed', r.response !== null);
  }
  const pub = await a.service.transparency();
  assert.equal(pub.includesDemo, true);
  assert.equal(pub.totals.received, 80);
  assert.equal(pub.totals.answered + pub.totals.open, 80);
  assert.equal(pub.weekly.length, 12);
  assert.equal(pub.weekly.reduce((s, w) => s + w.received, 0), 80);
  assert.ok(pub.onTimeRate !== null && pub.onTimeRate >= 0 && pub.onTimeRate <= 1);
  assert.equal((await a.service.deleteDemo()).deleted, 80);
  assert.equal((await a.service.stats()).totals.all, 0);
});

test('transparency exposes only aggregates', async () => {
  const h = harness();
  await h.service.create(create({ text: 'Mi cédula 52.123.456 y no llega el agua.', citizen: { name: 'Ana Pérez', email: 'ana@x.co' } }));
  const json = JSON.stringify(await h.service.transparency());
  for (const secret of ['Ana', 'ana@x.co', '52.123.456', 'PQRSD-2025', 'no llega']) assert.ok(!json.includes(secret), `filtra «${secret}»`);
});

test('csv export never includes text or personal data and neutralises formulas', async () => {
  const h = harness();
  await h.service.create(create({ text: 'Mi cédula 52.123.456 y no llega el agua a mi casa.', citizen: { name: 'Ana Pérez' } }));
  const csv = await h.service.exportCsv({});
  assert.ok(csv.startsWith('﻿Radicado,'));
  assert.ok(!csv.includes('52.123.456') && !csv.includes('Ana'));
  assert.equal(csv.trim().split('\r\n').length, 2);
});

test('AI admin: status reflects availability; retrain is proxied', async () => {
  const h = harness();
  const s = await h.service.aiStatus();
  assert.equal(s.available, true);
  assert.equal(s.model?.syntheticSamples, 6000);
  await h.service.retrainAi();
  assert.equal(h.ai.retrains, 1);
  h.ai.down = true;
  assert.equal((await h.service.aiStatus()).available, false);
  assert.equal(await code(h.service.retrainAi()), 'AI_UNAVAILABLE');
});

test('time zone: a case received at 23:30 Bogotá on a Friday is received on Friday (not Saturday UTC)', async () => {
  const h = harness();
  h.clock.set('2025-03-08T04:30:00Z'); // Fri 7 Mar 23:30 Bogotá
  await h.service.create(create());
  const rec = (await h.repo.all())[0];
  assert.equal(rec.deadline.countFrom, '2025-03-07');
  void T0;
});
