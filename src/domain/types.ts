export const PQRSD_TYPES = ['peticion', 'queja', 'reclamo', 'sugerencia', 'denuncia'] as const;
export const URGENCIES = ['critical', 'high', 'medium', 'low'] as const;
export const SUBTYPES = ['general', 'information', 'consultation'] as const;
export const STATUSES = ['pending_review', 'assigned', 'answered', 'closed'] as const;
export const CHANNELS = ['web', 'email', 'phone', 'in_person', 'social'] as const;
export const SLA_STATUSES = ['on_time', 'at_risk', 'overdue', 'done'] as const;

export type PqrsdType = (typeof PQRSD_TYPES)[number];
export type Urgency = (typeof URGENCIES)[number];
export type Subtype = (typeof SUBTYPES)[number];
export type Status = (typeof STATUSES)[number];
export type Channel = (typeof CHANNELS)[number];
export type SlaStatus = (typeof SLA_STATUSES)[number];

export const FALLBACK_DEPENDENCY = 'atencion_ciudadano';

export interface Citizen {
  name?: string;
  email?: string;
  phone?: string;
  documentId?: string;
}

export interface Entity {
  type: string;
  label: string;
  text: string;
  start: number;
  end: number;
  value: string | null;
  pii: boolean;
  approx: boolean;
}

/** What the AI (or the fallback) said, normalised to camelCase. Never edited after creation. */
export interface StoredClassification {
  source: 'ai' | 'fallback';
  type: { id: PqrsdType; confidence: number; reasons: string[] };
  dependency: { id: string; confidence: number; routedToFallback: boolean; reasons: string[] };
  urgency: { id: Urgency; confidence: number; priorityScore: number; reasons: string[] };
  subtype: { id: Subtype; confidence: number } | null;
  entities: Entity[];
  needsReview: boolean;
  reviewReasons: string[];
  modelVersion: string;
}

export interface Effective {
  type: PqrsdType;
  subtype: Subtype | null;
  dependency: string;
  urgency: Urgency;
}

export interface Deadline {
  legalDays: number;
  basis: string;
  verify: boolean;
  /** business date (YYYY-MM-DD, America/Bogota) from which the term starts counting (the next business day is day 1) */
  countFrom: string;
  dueDate: string;
}

export interface TimelineEvent {
  at: string;
  event: 'received' | 'classified' | 'confirmed' | 'reclassified' | 'answered' | 'closed';
  by: 'citizen' | 'ai' | 'fallback' | 'staff' | 'system';
  detail?: string;
}

export interface PqrsdRecord {
  id: string;
  radicado: string;
  trackingCode: string;
  text: string;
  channel: Channel;
  citizen: Citizen | null;
  receivedAt: string;
  classification: StoredClassification;
  effective: Effective;
  priorityScore: number;
  status: Status;
  reviewed: boolean;
  /** true when staff changed type, dependency or urgency relative to the AI (drives aiAgreementRate) */
  changedByStaff: boolean;
  deadline: Deadline;
  timeline: TimelineEvent[];
  response: { text: string; answeredAt: string } | null;
  isDemo: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface NamedId {
  id: string;
  label: string;
}

export interface PqrsdSummary {
  id: string;
  radicado: string;
  receivedAt: string;
  excerpt: string;
  status: Status;
  type: NamedId;
  dependency: { id: string; name: string };
  urgency: NamedId;
  priorityScore: number;
  needsReview: boolean;
  dueDate: string;
  businessDaysLeft: number;
  slaStatus: SlaStatus;
  source: 'ai' | 'fallback';
  isDemo: boolean;
}

export interface PqrsdDetail extends PqrsdSummary {
  text: string;
  channel: Channel;
  citizen: Citizen | null;
  classification: {
    source: 'ai' | 'fallback';
    type: StoredClassification['type'];
    dependency: StoredClassification['dependency'];
    urgency: StoredClassification['urgency'];
    subtype: StoredClassification['subtype'];
    entities: Entity[];
    reviewReasons: string[];
    modelVersion: string;
  };
  effective: Effective;
  deadline: Deadline;
  timeline: TimelineEvent[];
  response: { text: string; answeredAt: string } | null;
}

export interface Receipt {
  radicado: string;
  trackingCode: string;
  receivedAt: string;
  type: NamedId;
  dependency: { id: string; name: string };
  dueDate: string;
  legalDays: number;
  message: string;
}

export interface TaxonomyDto {
  types: Array<{ id: string; label: string; description: string }>;
  urgency: Array<{ id: string; label: string; description: string }>;
  subtypes: Array<{ id: string; label: string; description: string }>;
  dependencies: Array<{ id: string; name: string; description: string; keywords?: string[] }>;
  fallbackDependency: string;
}
