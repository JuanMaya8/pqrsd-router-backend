import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addBusinessDays, MemoryNotifier } from '../src/domain';
import { create, harness } from './helpers';

async function newCase(h: ReturnType<typeof harness>, over: Record<string, unknown> = {}) {
  const r = await h.service.create(create(over));
  const id = (await h.service.list({ q: r.radicado })).items[0].id;
  return { r, id };
}

test('assign puts a staff member in charge, is filterable and can be undone', async () => {
  const h = harness();
  const { id } = await newCase(h);
  const d = await h.service.assign(id, { assignee: '  María   Gómez ' });
  assert.equal(d.assignee, 'María Gómez');
  assert.equal(d.status, 'assigned');
  assert.equal(d.timeline.at(-1)?.event, 'assigned');
  await newCase(h);
  assert.equal((await h.service.list({ assignee: 'maria gomez' })).total, 1, 'accent and case insensitive');
  assert.equal((await h.service.list({ unassigned: 'true' })).total, 1);
  const undone = await h.service.assign(id, { assignee: null });
  assert.equal(undone.assignee, null);
  assert.match(undone.timeline.at(-1)?.detail ?? '', /sin responsable/);
  await assert.rejects(h.service.assign(id, { assignee: 'x' }), { code: 'VALIDATION_ERROR' });
});

test('assign is rejected once the case is answered', async () => {
  const h = harness();
  const { id } = await newCase(h);
  await h.service.answer(id, { response: 'Respuesta de fondo al ciudadano.' });
  await assert.rejects(h.service.assign(id, { assignee: 'Ana Ruiz' }), { status: 409 });
});

test('extend: once, before expiry, up to the initial term, with a reason (Art. 14 parágrafo)', async () => {
  const h = harness();
  const { id } = await newCase(h);
  const before = await h.service.get(id);
  const reason = 'Se necesita un concepto técnico de la empresa de acueducto.';
  await assert.rejects(h.service.extend(id, { days: 5, reason: 'corto' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(h.service.extend(id, { days: before.deadline.legalDays + 1, reason }), { code: 'VALIDATION_ERROR' });
  const d = await h.service.extend(id, { days: 10, reason });
  assert.equal(d.extension?.originalDueDate, before.dueDate);
  assert.equal(d.dueDate, addBusinessDays(before.dueDate, 10));
  assert.equal(d.extended, true);
  assert.equal(d.timeline.at(-1)?.event, 'extended');
  await assert.rejects(h.service.extend(id, { days: 2, reason }), { code: 'EXTENSION_NOT_ALLOWED' });
});

test('extend is refused after the term expired and for answered cases', async () => {
  const h = harness();
  const a = await newCase(h);
  const b = await newCase(h);
  const reason = 'Se requiere información de otra entidad para responder de fondo.';
  await h.service.answer(b.id, { response: 'Respuesta de fondo al ciudadano.' });
  await assert.rejects(h.service.extend(b.id, { days: 3, reason }), { code: 'EXTENSION_NOT_ALLOWED' });
  h.clock.set('2025-06-30T15:00:00Z');
  await assert.rejects(h.service.extend(a.id, { days: 3, reason }), /venció/);
});

test('reclassifying keeps an extension on top of the recomputed term', async () => {
  const h = harness();
  const { id } = await newCase(h);
  await h.service.extend(id, { days: 12, reason: 'Se necesita visita técnica al barrio antes de responder.' });
  const d = await h.service.reclassify(id, { type: 'peticion', subtype: 'information' }); // 10-day term
  assert.equal(d.deadline.legalDays, 10);
  assert.equal(d.extension?.days, 10, 'capped at the new initial term');
  assert.equal(d.dueDate, addBusinessDays(d.extension!.originalDueDate, 10));
});

test('the public tracking shows the extension and the new date, never the internal reason or the assignee', async () => {
  const h = harness();
  const { r, id } = await newCase(h);
  await h.service.assign(id, { assignee: 'Carlos Pérez' });
  const reason = 'Motivo interno: falta el informe del contratista de la obra.';
  const d = await h.service.extend(id, { days: 5, reason });
  const t = await h.service.tracking(r.radicado, r.trackingCode);
  assert.equal(t.dueDate, d.dueDate);
  assert.ok(t.timeline.some((e) => e.event === 'extended' && /amplió el plazo/.test(e.label)));
  const json = JSON.stringify(t);
  assert.ok(!json.includes('Carlos') && !json.includes('contratista'));
});

test('citizen e-mails: receipt, extension and answer; none for anonymous, demo cases or when sending fails', async () => {
  const mail = new MemoryNotifier();
  const h = harness({ notifier: mail, publicAppUrl: 'https://pqrsd.example.gov.co' });
  const { r, id } = await newCase(h, { citizen: { name: 'Ana', email: 'ana@correo.co' } });
  await h.service.idle();
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'ana@correo.co');
  assert.match(mail.sent[0].subject, new RegExp(r.radicado));
  assert.ok(mail.sent[0].text.includes(`https://pqrsd.example.gov.co/consulta/${r.radicado}?code=${r.trackingCode}`));

  await h.service.extend(id, { days: 3, reason: 'Se necesita un concepto técnico adicional.' });
  await h.service.answer(id, { response: 'Ya restablecimos el servicio de agua en tu barrio.' });
  await h.service.idle();
  assert.deepEqual(mail.sent.map((m) => m.subject.split(' ')[0]), ['Radicamos', 'Ampliamos', 'Respondimos']);
  assert.ok(mail.sent[2].text.includes('restablecimos'));

  await newCase(h, { anonymous: true, citizen: { email: 'x@correo.co' } });
  await h.service.seedDemo({ count: 5 }, 7);
  mail.failNext = true;
  await newCase(h, { citizen: { email: 'b@correo.co' } }); // SMTP down: the case is still filed
  await h.service.idle();
  assert.equal(mail.sent.length, 3);
});
