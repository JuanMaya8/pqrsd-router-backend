export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** Test clock: fixed instant that tests can move. */
export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current.getTime()); }
  set(iso: string): void { this.current = new Date(iso); }
  advanceHours(h: number): void { this.current = new Date(this.current.getTime() + h * 3_600_000); }
}
