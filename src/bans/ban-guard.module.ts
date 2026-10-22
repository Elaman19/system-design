import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { BanMiddleware } from './ban.middleware.js';

/** The API side of bans: every request from a banned IP gets 429 (health probes excepted). */
@Module({ providers: [BanMiddleware] })
export class BanGuardModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(BanMiddleware)
      .exclude(
        { path: 'live', method: RequestMethod.ALL },
        { path: 'ready', method: RequestMethod.ALL },
      )
      .forRoutes('{*path}');
  }
}
