import { AiClient, type AiClassification } from './ai-client';
import { AiUnavailableError } from './errors';
import { bogotaDate } from './calendar';
import type { Clock } from './clock';
import { DEFAULT_TAXONOMY } from './labels';
import { fallbackClassify } from './fallback-classifier';
import type { StoredClassification, TaxonomyDto } from './types';

export function fromAi(c: AiClassification): StoredClassification {
  return {
    source: 'ai',
    type: { id: c.type.id, confidence: c.type.confidence, reasons: c.type.reasons ?? [] },
    dependency: { id: c.dependency.id, confidence: c.dependency.confidence, routedToFallback: c.dependency.routed_to_fallback, reasons: c.dependency.reasons ?? [] },
    urgency: { id: c.urgency.id, confidence: c.urgency.confidence, priorityScore: c.urgency.priority_score, reasons: c.urgency.reasons ?? [] },
    subtype: c.subtype ? { id: c.subtype.id, confidence: c.subtype.confidence } : null,
    entities: c.entities ?? [],
    needsReview: c.needs_review,
    reviewReasons: c.review_reasons ?? [],
    modelVersion: c.model_version,
  };
}

/** Caches the AI taxonomy (so dependency names always match what the model routes to) and falls back to the built-in one. */
export class TaxonomyProvider {
  private cached: TaxonomyDto | null = null;
  private fetchedAt = 0;
  constructor(private readonly ai: AiClient, private readonly clock: Clock, private readonly ttlMs = 10 * 60_000) {}

  async get(): Promise<TaxonomyDto> {
    const now = this.clock.now().getTime();
    if (this.cached && now - this.fetchedAt < this.ttlMs) return this.cached;
    try {
      const t = await this.ai.taxonomy();
      this.cached = { types: t.types, urgency: t.urgency, subtypes: t.subtypes, dependencies: t.dependencies, fallbackDependency: t.fallback_dependency };
    } catch {
      this.cached ??= DEFAULT_TAXONOMY;
    }
    this.fetchedAt = now;
    return this.cached;
  }
}

/**
 * Classification with graceful degradation. After a failure the AI is skipped for `cooldownMs`, so a dead AI costs
 * one timeout, not one per citizen request.
 */
export class ClassificationService {
  private downUntil = 0;
  constructor(private readonly ai: AiClient, private readonly clock: Clock, private readonly cooldownMs = 20_000) {}

  get aiLooksDown(): boolean {
    return this.clock.now().getTime() < this.downUntil;
  }

  private markDown(): void {
    this.downUntil = this.clock.now().getTime() + this.cooldownMs;
  }

  async classify(text: string, receivedAt: Date = this.clock.now()): Promise<StoredClassification> {
    if (this.aiLooksDown) return fallbackClassify(text);
    try {
      return fromAi(await this.ai.classify(text, bogotaDate(receivedAt)));
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      this.markDown();
      return fallbackClassify(text);
    }
  }

  /** Chunks of 200 (the AI limit). If the AI dies mid-way, the remaining chunks use the fallback. */
  async classifyMany(texts: string[], referenceDate: string): Promise<StoredClassification[]> {
    const out: StoredClassification[] = [];
    for (let i = 0; i < texts.length; i += 200) {
      const chunk = texts.slice(i, i + 200);
      if (this.aiLooksDown) {
        out.push(...chunk.map(fallbackClassify));
        continue;
      }
      try {
        const res = await this.ai.classifyBatch(chunk.map((text) => ({ text })), referenceDate);
        out.push(...res.results.map((r) => fromAi(r.classification)));
      } catch (e) {
        if (!(e instanceof AiUnavailableError)) throw e;
        this.markDown();
        out.push(...chunk.map(fallbackClassify));
      }
    }
    return out;
  }
}
