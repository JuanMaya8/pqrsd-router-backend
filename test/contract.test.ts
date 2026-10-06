/**
 * Contract check against REAL output of pqrsd-router-ai (test/fixtures/ai-responses.json was produced by running
 * the Python service: `RouterService.classify(...)` → JSON). If the AI changes its response shape, regenerate the fixture and fix `fromAi`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AiClient, BlobPqrsdRepository, ClassificationService, EventBus, FakeClock, MemoryBlobStore, PqrsdService, TaxonomyProvider, DEFAULT_DEADLINE_CONFIG, DEFAULT_TAXONOMY, fromAi, type FetchLike } from '../src/domain';

const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ai-responses.json'), 'utf8')) as {
  taxonomy: any;
  classifications: Array<{ text: string; response: any }>;
};

test('the built-in taxonomy matches the AI taxonomy (ids, labels, order)', () => {
  assert.deepEqual(DEFAULT_TAXONOMY.types.map((t) => [t.id, t.label]), fx.taxonomy.types.map((t: any) => [t.id, t.label]));
  assert.deepEqual(DEFAULT_TAXONOMY.urgency.map((t) => [t.id, t.label]), fx.taxonomy.urgency.map((t: any) => [t.id, t.label]));
  assert.deepEqual(DEFAULT_TAXONOMY.subtypes.map((t) => t.id), fx.taxonomy.subtypes.map((t: any) => t.id));
  assert.deepEqual(DEFAULT_TAXONOMY.dependencies.map((d) => [d.id, d.name]), fx.taxonomy.dependencies.map((d: any) => [d.id, d.name]));
  assert.equal(DEFAULT_TAXONOMY.fallbackDependency, fx.taxonomy.fallback_dependency);
});

test('fromAi maps every real AI response to a complete stored classification', () => {
  for (const { text, response } of fx.classifications) {
    const c = fromAi(response);
    assert.equal(c.source, 'ai');
    assert.ok(['peticion', 'queja', 'reclamo', 'sugerencia', 'denuncia'].includes(c.type.id), text);
    assert.ok(DEFAULT_TAXONOMY.dependencies.some((d) => d.id === c.dependency.id), `${text}: ${c.dependency.id}`);
    assert.ok(['critical', 'high', 'medium', 'low'].includes(c.urgency.id));
    assert.ok(c.urgency.priorityScore >= 0 && c.urgency.priorityScore <= 100);
    assert.equal(typeof c.needsReview, 'boolean');
    assert.ok(Array.isArray(c.entities) && c.reviewReasons.length >= 0);
    assert.equal(c.subtype === null, c.type.id !== 'peticion');
    for (const e of c.entities) assert.ok(typeof e.start === 'number' && typeof e.pii === 'boolean');
  }
});

test('the real AI responses flow through the whole service (create, feedback redaction, tracking)', async () => {
  const byText = new Map(fx.classifications.map((c) => [c.text, c.response]));
  const sent: any[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => '' });
    if (path === '/v1/classify') return ok(byText.get(body.text));
    if (path === '/v1/taxonomy') return ok(fx.taxonomy);
    if (path === '/v1/feedback') { sent.push(body); return ok({ stored: true, total_feedback: 1 }); }
    return ok({ status: 'ok' });
  };
  const clock = new FakeClock(new Date('2025-03-05T15:00:00Z'));
  const ai = new AiClient({ baseUrl: 'http://ai.test', fetchImpl });
  const service = new PqrsdService({
    repo: new BlobPqrsdRepository(new MemoryBlobStore()), ai, events: new EventBus(), clock,
    classifier: new ClassificationService(ai, clock), taxonomy: new TaxonomyProvider(ai, clock),
    deadlineConfig: DEFAULT_DEADLINE_CONFIG, autoAssignMinConfidence: 0, feedbackOnConfirm: false,
  });
  const first = fx.classifications[0];
  const receipt = await service.create({ text: first.text, consent: true });
  assert.equal(receipt.dependency.id, first.response.dependency.id);
  const tracking = await service.tracking(receipt.radicado, receipt.trackingCode);
  assert.equal(tracking.status, 'pending_review');
  // reclassifying sends the text WITHOUT the personal data the real AI flagged
  const id = (await service.list({})).items[0].id;
  await service.reclassify(id, { urgency: 'low' });
  await service.idle();
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].text.includes('52.123.456'), sent[0].text);
  assert.ok(!sent[0].text.includes('3001234567'), sent[0].text);
  assert.ok(!sent[0].text.includes('Ana Pérez'), sent[0].text);
});
