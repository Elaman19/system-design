import { Module } from '@nestjs/common';
import { TxHooksModule } from '../common/tx-hooks/tx-hooks.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { OutboxRelayService } from './outbox-relay.service.js';

@Module({
  imports: [QueueModule, TxHooksModule],
  providers: [OutboxRelayService],
})
export class OutboxModule {}
