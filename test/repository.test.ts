import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BlobPqrsdRepository, FileBlobStore, MemoryBlobStore } from '../src/domain';
import { create, diskHarness } from './helpers';

test('records and the counter survive a restart (FileBlobStore)', async () => {
  const h = diskHarness();
  try {
    const r1 = await h.service.create(create());
    const r2 = await h.service.create(create());
    const id = (await h.service.list({ sort: 'receivedAt:desc' })).items[0].id;
    await h.service.confirm(id, {});
    // «restart»: a brand-new repository over the same directory
    const repo2 = new BlobPqrsdRepository(h.store);
    assert.equal((await repo2.all()).length, 2);
    assert.equal((await repo2.findByRadicado(r1.radicado))?.trackingCode, r1.trackingCode);
    assert.equal((await repo2.get(id))?.status, 'assigned');
    assert.equal(await repo2.reserve(2025, 1), 3);
    assert.ok(r2.radicado.endsWith('000002'));
  } finally {
    h.cleanup();
  }
});

test('the counter can never fall behind the radicados on disk, and corrupt files are skipped', async () => {
  const h = diskHarness();
  try {
    await h.service.create(create());
    await h.service.create(create());
    // crash simulation: the counter file is lost/stale, a corrupt record appears
    const dir = (h.store as unknown as { dir: string }).dir;
    writeFileSync(join(dir, 'counter.json'), '{"2025":1}');
    writeFileSync(join(dir, 'pq_aaaaaaaaaaaa.pqrsd.json'), '{broken');
    const repo2 = new BlobPqrsdRepository(new FileBlobStore(dir));
    assert.equal((await repo2.all()).length, 2);
    assert.equal(await repo2.reserve(2025, 1), 3);
  } finally {
    h.cleanup();
  }
});

test('reserve gives disjoint consecutive ranges, per year', async () => {
  const repo = new BlobPqrsdRepository(new MemoryBlobStore());
  const [a, b, c] = await Promise.all([repo.reserve(2025, 5), repo.reserve(2025, 3), repo.reserve(2026, 2)]);
  assert.deepEqual([a, b, c].sort(), [1, 1, 6].sort());
  assert.equal(await repo.reserve(2025, 1), 9);
  assert.equal(await repo.reserve(2026, 1), 3);
});

test('removeWhere deletes only matching records, also on disk', async () => {
  const h = diskHarness();
  try {
    await h.service.create(create());
    await h.service.seedDemo({ count: 5 }, 3);
    assert.equal((await h.service.deleteDemo()).deleted, 5);
    const repo2 = new BlobPqrsdRepository(h.store);
    assert.equal((await repo2.all()).length, 1);
  } finally {
    h.cleanup();
  }
});
