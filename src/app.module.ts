import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core.module';
import type { AppConfig, FetchLike } from './domain';
import { AllExceptionsFilter } from './http/exceptions.filter';
import { PublicWriteGuard } from './http/public-write.guard';
import { StaffGuard } from './http/staff.guard';
import { PublicController } from './modules/public.controller';
import { RealtimeGateway } from './modules/realtime.gateway';
import { StaffController } from './modules/staff.controller';

@Module({})
export class AppModule {
  static register(config: AppConfig, fetchImpl?: FetchLike): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, fetchImpl), ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.throttleLimit }])],
      controllers: [PublicController, StaffController],
      providers: [
        RealtimeGateway,
        StaffGuard,
        PublicWriteGuard,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    };
  }
}
