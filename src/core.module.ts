import { DynamicModule, Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import {
  AiClient, BlobPqrsdRepository, ClassificationService, DEFAULT_DEADLINE_CONFIG, EventBus, FileBlobStore, PqrsdService, RateLimiter, TaxonomyProvider, systemClock,
  type AppConfig, type FetchLike,
} from './domain';
import { TOKENS } from './tokens';

/** Wires the framework-free domain objects. `fetchImpl` is injectable so e2e tests can fake the AI service. */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig, fetchImpl?: FetchLike): DynamicModule {
    const events = new EventBus();
    const ai = new AiClient({ baseUrl: config.aiUrl, apiKey: config.aiApiKey, timeoutMs: config.aiTimeoutMs, fetchImpl });
    const service = new PqrsdService({
      repo: new BlobPqrsdRepository(new FileBlobStore(join(config.dataDir, 'pqrsd'))),
      ai,
      events,
      clock: systemClock,
      classifier: new ClassificationService(ai, systemClock),
      taxonomy: new TaxonomyProvider(ai, systemClock),
      deadlineConfig: { ...DEFAULT_DEADLINE_CONFIG, denunciaDays: config.denunciaDays },
      autoAssignMinConfidence: config.autoAssignMinConfidence,
      feedbackOnConfirm: config.feedbackOnConfirm,
    });
    const providers = [
      { provide: TOKENS.CONFIG, useValue: config },
      { provide: TOKENS.EVENTS, useValue: events },
      { provide: TOKENS.SERVICE, useValue: service },
      { provide: TOKENS.LIMITER, useValue: new RateLimiter(config.publicWriteLimit, 60_000, systemClock) },
    ];
    return { module: CoreModule, providers, exports: providers.map((p) => p.provide) };
  }
}
