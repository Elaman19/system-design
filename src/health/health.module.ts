import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { connectionCloseOnShutdown } from './connection-close.middleware.js';
import { HealthController } from './health.controller.js';
import { ShutdownService } from './shutdown.service.js';
import { WorkController } from './work.controller.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, WorkController],
  providers: [ShutdownService],
})
export class HealthModule implements NestModule {
  constructor(private readonly shutdown: ShutdownService) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(connectionCloseOnShutdown(() => this.shutdown.isShuttingDown))
      .forRoutes('*path');
  }
}
