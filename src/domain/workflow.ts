import { InvalidTransitionError } from './errors';
import type { Status } from './types';

export type Action = 'confirm' | 'reclassify' | 'answer' | 'close';

const NEXT: Record<Action, { from: Status[]; to: Status }> = {
  confirm: { from: ['pending_review'], to: 'assigned' },
  reclassify: { from: ['pending_review', 'assigned'], to: 'assigned' },
  answer: { from: ['pending_review', 'assigned'], to: 'answered' },
  close: { from: ['answered'], to: 'closed' },
};

export function transition(from: Status, action: Action): Status {
  const rule = NEXT[action];
  if (!rule.from.includes(from)) throw new InvalidTransitionError(from, action);
  return rule.to;
}

export const isOpen = (s: Status): boolean => s === 'pending_review' || s === 'assigned';
export const isAnswered = (s: Status): boolean => s === 'answered' || s === 'closed';
