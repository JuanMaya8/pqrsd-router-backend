import type { NamedId } from './types';

export interface EventMap {
  'pqrsd.created': { id: string; radicado: string; type: string; dependency: string; urgency: string; priorityScore: number; needsReview: boolean };
  'pqrsd.updated': { id: string; radicado: string; status: string; slaStatus: string };
  'stats.changed': { at: string };
}
export type EventName = keyof EventMap;
export type Listener = <K extends EventName>(event: K, payload: EventMap[K]) => void;
export type { NamedId };

/** Tiny typed pub/sub. The socket.io gateway subscribes; domain services publish. Payloads never contain personal data. */
export class EventBus {
  private listeners = new Set<Listener>();
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  publish<K extends EventName>(event: K, payload: EventMap[K]): void {
    for (const l of this.listeners) {
      try {
        l(event, payload);
      } catch {
        /* a broken listener must not break a request */
      }
    }
  }
}
