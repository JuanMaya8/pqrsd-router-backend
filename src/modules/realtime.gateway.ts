import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, OnModuleDestroy, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { loadConfig, type AppConfig, type EventBus } from '../domain';
import { staffKeyMatches } from '../http/staff.guard';
import { TOKENS } from '../tokens';

/**
 * socket.io namespace `/realtime`. A client that connects with `auth: { staffKey }` joins room «staff»; everyone else joins «public».
 * Payloads never contain personal data (see docs/CONTRACT.md §4.4).
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: loadConfig().corsOrigins } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger('Realtime');
  private unsubscribe: (() => void) | null = null;

  constructor(@Inject(TOKENS.EVENTS) private readonly events: EventBus, @Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  afterInit(): void {
    this.unsubscribe = this.events.subscribe((event, payload) => {
      if (event === 'stats.changed') this.server.to('staff').to('public').emit(event, payload);
      else this.server.to('staff').emit(event, payload);
    });
    this.logger.log('Namespace /realtime listo');
  }

  handleConnection(client: Socket): void {
    const sent = (client.handshake.auth as { staffKey?: unknown } | undefined)?.staffKey;
    const isStaff = this.config.staffKey ? staffKeyMatches(this.config.staffKey, sent) : this.config.nodeEnv !== 'production';
    void client.join(isStaff ? 'staff' : 'public');
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
