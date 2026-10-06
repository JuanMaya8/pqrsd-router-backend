import type { BlobStore } from './blob-store';
import { ID_RE } from './ids';
import type { PqrsdRecord } from './types';

export interface PqrsdRepository {
  /** Reserves `n` consecutive sequence numbers for `year` and returns the first one (one disk write, however big `n` is). */
  reserve(year: number, n: number): Promise<number>;
  insert(rec: PqrsdRecord): Promise<void>;
  insertMany(recs: PqrsdRecord[]): Promise<void>;
  update(rec: PqrsdRecord): Promise<void>;
  get(id: string): Promise<PqrsdRecord | null>;
  findByRadicado(radicado: string): Promise<PqrsdRecord | null>;
  all(): Promise<PqrsdRecord[]>;
  removeWhere(pred: (r: PqrsdRecord) => boolean): Promise<number>;
}

const recKey = (id: string): string => `${id}.pqrsd.json`;
const COUNTER_KEY = 'counter.json';

/**
 * One JSON blob per case plus a counter file, with an in-memory index (fine up to tens of thousands of cases).
 * Swap this class for a Postgres implementation of `PqrsdRepository` without touching callers
 * (the service only needs: sequence, insert/update, get by id/radicado, scan, delete).
 */
export class BlobPqrsdRepository implements PqrsdRepository {
  private index: Map<string, PqrsdRecord> | null = null;
  private byRadicado = new Map<string, string>();
  private counters: Record<string, number> = {};
  private loading: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: BlobStore) {}

  private async load(): Promise<Map<string, PqrsdRecord>> {
    if (this.index) return this.index;
    this.loading ??= (async () => {
      const map = new Map<string, PqrsdRecord>();
      const maxSeq: Record<string, number> = {};
      for (const key of await this.store.list('.pqrsd.json')) {
        const raw = await this.store.read(key);
        if (!raw) continue;
        try {
          const r = JSON.parse(raw) as PqrsdRecord;
          if (!ID_RE.test(r.id)) continue;
          map.set(r.id, r);
          this.byRadicado.set(r.radicado, r.id);
          const m = /^PQRSD-(\d{4})-(\d{6})$/.exec(r.radicado);
          if (m) maxSeq[m[1]] = Math.max(maxSeq[m[1]] ?? 0, Number(m[2]));
        } catch {
          /* ignore a corrupt file: never block the boot */
        }
      }
      let saved: Record<string, number> = {};
      try {
        saved = JSON.parse((await this.store.read(COUNTER_KEY)) ?? '{}') as Record<string, number>;
      } catch {
        /* rebuilt from the records below */
      }
      // the counter can never be behind the highest radicado on disk (crash between insert and counter write)
      for (const y of new Set([...Object.keys(saved), ...Object.keys(maxSeq)])) this.counters[y] = Math.max(saved[y] ?? 0, maxSeq[y] ?? 0);
      this.index = map;
    })();
    await this.loading;
    return this.index!;
  }

  /** Serialises writes that touch shared state (counter) so concurrent requests never share a radicado. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async reserve(year: number, n: number): Promise<number> {
    await this.load();
    return this.serial(async () => {
      const k = String(year);
      const first = (this.counters[k] ?? 0) + 1;
      this.counters[k] = first + n - 1;
      await this.store.write(COUNTER_KEY, JSON.stringify(this.counters));
      return first;
    });
  }

  async insert(rec: PqrsdRecord): Promise<void> {
    const idx = await this.load();
    await this.store.write(recKey(rec.id), JSON.stringify(rec));
    idx.set(rec.id, rec);
    this.byRadicado.set(rec.radicado, rec.id);
  }

  async insertMany(recs: PqrsdRecord[]): Promise<void> {
    const idx = await this.load();
    const BATCH = 50;
    for (let i = 0; i < recs.length; i += BATCH) {
      await Promise.all(recs.slice(i, i + BATCH).map((r) => this.store.write(recKey(r.id), JSON.stringify(r))));
    }
    for (const r of recs) {
      idx.set(r.id, r);
      this.byRadicado.set(r.radicado, r.id);
    }
  }

  async update(rec: PqrsdRecord): Promise<void> {
    const idx = await this.load();
    await this.store.write(recKey(rec.id), JSON.stringify(rec));
    idx.set(rec.id, rec);
  }

  async get(id: string): Promise<PqrsdRecord | null> {
    return (await this.load()).get(id) ?? null;
  }

  async findByRadicado(radicado: string): Promise<PqrsdRecord | null> {
    const idx = await this.load();
    const id = this.byRadicado.get(radicado);
    return id ? idx.get(id) ?? null : null;
  }

  async all(): Promise<PqrsdRecord[]> {
    return [...(await this.load()).values()];
  }

  async removeWhere(pred: (r: PqrsdRecord) => boolean): Promise<number> {
    const idx = await this.load();
    const doomed = [...idx.values()].filter(pred);
    for (let i = 0; i < doomed.length; i += 50) await Promise.all(doomed.slice(i, i + 50).map((r) => this.store.remove(recKey(r.id))));
    for (const r of doomed) {
      idx.delete(r.id);
      this.byRadicado.delete(r.radicado);
    }
    return doomed.length;
  }
}
