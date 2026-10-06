import type { Clock } from './clock';

/** Fixed-window counter per key (IP). In memory: per instance, which is fine for a single replica; use Redis behind several. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly clock: Clock) {}

  /** true = allowed. */
  hit(key: string): boolean {
    const now = this.clock.now().getTime();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    }
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}
