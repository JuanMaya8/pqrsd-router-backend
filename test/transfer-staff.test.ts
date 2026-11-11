import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEV_STAFF_NAME, MemoryNotifier, SHARED_STAFF_NAME, loadConfig, parseStaffUsers, resolveStaff } from '../src/domain';
import { create, harness } from './helpers';

async function newCase(h: ReturnType<typeof harness>, over: Record<string, unknown> = {}) {
  const r = await h.service.create(create(over));
  const id = (await h.service.list({ q: r.radicado })).items[0].id;
  return { r, id };
}

const reason = 'La facturación de energía la vigila la Superintendencia, no la alcaldía.';

test('STAFF_USERS parses «Name:key» pairs and rejects malformed entries', () => {
  assert.deepEqual(parseStaffUsers(' Ana  Pérez:clave-ana-1 , Luis Ruiz:a:b:clave-luis'), [
    { name: 'Ana Pérez', key: 'clave-ana-1' },
    { name: 'Luis Ruiz:a:b', key: 'clave-luis' },
  ]);
  assert.deepEqual(parseStaffUsers(undefined), []);
  assert.throws(() => parseStaffUsers('Ana:corta'), /STAFF_USERS/);
  assert.throws(() => parseStaffUsers('sinclave'), /STAFF_USERS/);
  assert.throws(() => parseStaffUsers('Ana Pérez:clave-igual,Luis Ruiz:clave-igual'), /repetida/);
  assert.equal(loadConfig({ STAFF_USERS: 'Ana Pérez:clave-ana-1' }).staffUsers.length, 1);
});

test('resolveStaff names the person behind a key', () => {
  const auth = { staffKey: 'shared-key', staffUsers: parseStaffUsers('Ana Pérez:clave-ana-1') };
  assert.equal(resolveStaff(auth, 'clave-ana-1'), 'Ana Pérez');
  assert.equal(resolveStaff(auth, 'shared-key'), SHARED_STAFF_NAME);
  assert.equal(resolveStaff(auth, 'wrong'), null);
  assert.equal(resolveStaff(auth, undefined), null);
  assert.equal(resolveStaff({ staffUsers: [] }, undefined), DEV_STAFF_NAME);
});

test('staff actions record who acted, and the public tracking never shows it', async () => {
  const h = harness();
  const { r, id } = await newCase(h);
  const d = await h.service.assign(id, { assignee: 'Ana Pérez' }, 'Luis Ruiz');
  assert.equal(d.timeline.at(-1)?.actor, 'Luis Ruiz');
  const pub = await h.service.tracking(r.radicado, r.trackingCode);
  assert.ok(!JSON.stringify(pub).includes('Luis Ruiz'));
  assert.ok(!JSON.stringify(pub).includes('Ana Pérez'));
});

test('transfer (Art. 21) closes the case with the transfer letter as response and tells the citizen', async () => {
  const mail = new MemoryNotifier();
  const h = harness({ notifier: mail });
  const { r, id } = await newCase(h, { citizen: { name: 'Carmen', email: 'carmen@example.com' } });
  await assert.rejects(h.service.transfer(id, { entity: 'X', reason }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(h.service.transfer(id, { entity: 'Superintendencia', reason: 'corto' }), { code: 'VALIDATION_ERROR' });
  const d = await h.service.transfer(id, { entity: ' Superintendencia de  Servicios Públicos ', reason }, 'Ana Pérez');
  assert.equal(d.status, 'closed');
  assert.equal(d.transfer?.entity, 'Superintendencia de Servicios Públicos');
  assert.equal(d.transfer?.late, false);
  assert.match(d.response?.text ?? '', /artículo 21 de la Ley 1437/);
  assert.equal(d.timeline.at(-1)?.event, 'transferred');
  assert.equal(d.slaStatus, 'done');
  const pub = await h.service.tracking(r.radicado, r.trackingCode);
  assert.equal(pub.transfer?.entity, 'Superintendencia de Servicios Públicos');
  assert.match(pub.timeline.at(-1)?.label ?? '', /Art\. 21/);
  await h.service.idle();
  assert.ok(mail.sent.some((m) => /Trasladamos/.test(m.subject)));
  await assert.rejects(h.service.transfer(id, { entity: 'Otra entidad', reason }), { status: 409 });
});

test('transfer after the 5 business days is allowed but recorded as late', async () => {
  const h = harness();
  const { id } = await newCase(h);
  h.clock.set('2025-03-20T15:00:00Z');
  const d = await h.service.transfer(id, { entity: 'Superintendencia de Salud', reason });
  assert.equal(d.transfer?.late, true);
  assert.match(d.timeline.at(-1)?.detail ?? '', /fuera de los 5 días/);
});
