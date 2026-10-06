import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrubCitizen, AiClient, ValidationError, fallbackClassify, parseCreate, parseListQuery, parseReclassify, parseSeed, redactPii, type FetchLike, type Entity } from '../src/domain';

const ok = { text: 'Un texto suficientemente largo para radicar', consent: true };

test('parseCreate normalises and validates', () => {
  const v = parseCreate({ ...ok, text: `  ${ok.text}\u0000  `, citizen: { name: ' Ana ', email: 'ana@x.co', phone: '300 123 4567', documentId: '52123456' } });
  assert.equal(v.text, ok.text);
  assert.equal(v.channel, 'web');
  assert.equal(v.citizen?.name, 'Ana');
  assert.throws(() => parseCreate({ ...ok, channel: 'fax' }), ValidationError);
  assert.throws(() => parseCreate({ ...ok, text: 'x'.repeat(10_001) }), ValidationError);
  assert.throws(() => parseCreate({ ...ok, citizen: { phone: 'abc' } }), ValidationError);
  assert.throws(() => parseCreate({ ...ok, citizen: { documentId: '<script>' } }), ValidationError);
  assert.throws(() => parseCreate('texto'), ValidationError);
  assert.throws(() => parseCreate(null), ValidationError);
  assert.equal(parseCreate({ ...ok, citizen: {} }).citizen, null);
});

test('parseReclassify requires at least one valid field', () => {
  assert.throws(() => parseReclassify({}), ValidationError);
  assert.throws(() => parseReclassify({ type: 'queja ' }), ValidationError);
  assert.throws(() => parseReclassify({ urgency: 'urgent' }), ValidationError);
  assert.deepEqual(parseReclassify({ type: 'queja', note: ' x ' }), { type: 'queja', note: 'x' });
});

test('parseListQuery defaults, bounds and bad values', () => {
  const d = parseListQuery({});
  assert.deepEqual([d.sort, d.limit, d.offset, d.status, d.q], ['priority:desc', 50, 0, undefined, undefined]);
  assert.equal(parseListQuery({ limit: '200', needsReview: 'true' }).needsReview, true);
  for (const bad of [{ limit: '0' }, { limit: '201' }, { offset: '-1' }, { status: 'x' }, { needsReview: 'maybe' }, { sort: 'name' }, { dependency: 'Bad Id' }]) {
    assert.throws(() => parseListQuery(bad), ValidationError, JSON.stringify(bad));
  }
});

test('parseSeed bounds', () => {
  assert.equal(parseSeed(undefined).count, 60);
  assert.equal(parseSeed({}).count, 60);
  assert.throws(() => parseSeed({ count: 0 }), ValidationError);
  assert.throws(() => parseSeed({ count: 501 }), ValidationError);
});

test('fallback classifier is conservative', () => {
  const g = fallbackClassify('Hay una fuga de gas, es una emergencia');
  assert.equal(g.urgency.id, 'critical');
  assert.equal(g.needsReview, true);
  assert.equal(g.dependency.id, 'atencion_ciudadano');
  assert.equal(g.source, 'fallback');
  const plain = fallbackClassify('Quiero saber el horario de la oficina');
  assert.equal(plain.type.id, 'peticion');
  assert.equal(plain.urgency.id, 'medium');
  assert.equal(fallbackClassify('Denuncio un caso de corrupción').type.id, 'denuncia');
  assert.equal(fallbackClassify('barrio centro').urgency.id, 'medium'); // «bar» style substrings must not match
});

test('redactPii replaces only personal data, by offsets, and survives overlaps and bad offsets', () => {
  const text = 'Soy Ana Pérez, cédula 52.123.456, vivo en Cali.';
  const e = (t: string, type: string, pii: boolean, label: string): Entity => ({ type, label, text: t, start: text.indexOf(t), end: text.indexOf(t) + t.length, value: null, pii, approx: false });
  const ents: Entity[] = [e('Ana Pérez', 'person', true, 'Persona'), e('52.123.456', 'document_id', true, 'Documento'), e('Cali', 'place', false, 'Lugar'), { ...e('x', 'email', true, 'Correo'), start: 500, end: 600 }];
  assert.equal(redactPii(text, ents), 'Soy [PERSONA], cédula [DOCUMENTO], vivo en Cali.');
  const overlapping: Entity[] = [{ ...e('Ana Pérez', 'person', true, 'Persona') }, { ...e('Ana', 'person', true, 'Persona') }];
  assert.ok(!redactPii(text, overlapping).includes('Pérez'));
});

function client(fn: FetchLike, timeoutMs = 50) {
  return new AiClient({ baseUrl: 'http://ai.test/', apiKey: 'k', timeoutMs, fetchImpl: fn });
}
const res = (status: number, json: unknown = {}) => ({ ok: status < 300, status, json: async () => json, text: async () => '' });

test('AiClient: key header, URL normalisation, error mapping', async () => {
  let seen: { url: string; headers: Record<string, string> } | null = null;
  const c = client(async (url, init) => { seen = { url, headers: init.headers }; return res(200, { status: 'ok' }); });
  await c.health();
  assert.equal(seen!.url, 'http://ai.test/health');
  assert.equal(seen!.headers['X-API-Key'], 'k');
  await assert.rejects(client(async () => res(503)).classify('x', '2025-01-01'), { code: 'AI_UNAVAILABLE' });
  await assert.rejects(client(async () => res(401)).classify('x', '2025-01-01'), { code: 'AI_UNAVAILABLE' }); // our key is wrong, not the citizen's fault
  await assert.rejects(client(async () => res(422, { code: 'UNKNOWN_DEPENDENCY', message: 'No existe' })).feedback({ text: 'x' }), { code: 'UNKNOWN_DEPENDENCY', status: 422 });
  await assert.rejects(client(async () => { throw new TypeError('fetch failed'); }).health(), { code: 'AI_UNAVAILABLE' });
});

test('AiClient: timeouts become AI_UNAVAILABLE', async () => {
  const slow: FetchLike = (_u, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(client(slow, 20).classify('x', '2025-01-01'), { code: 'AI_UNAVAILABLE', message: /tiempo de espera/ });
});

test('scrubCitizen removes what the citizen declared even if the AI missed it', () => {
  const c = { name: 'María Fernanda Gómez', email: 'maria@correo.co', phone: '300 123 4567', documentId: '52.123.456' };
  const text = 'Escribo yo, María Fernanda Gómez (Fernanda para los amigos). Mi correo maria@correo.co, mi cel 3001234567 y mi cédula 52123456. Vivo en Cali.';
  const out = scrubCitizen(text, c);
  for (const leak of ['María', 'Fernanda', 'Gómez', 'maria@correo.co', '3001234567', '52123456']) assert.ok(!out.includes(leak), `${leak} → ${out}`);
  assert.ok(out.includes('Cali'));
  assert.equal(scrubCitizen(text, null), text);
});
