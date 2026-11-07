import { Module } from '@nestjs/common';
import { TxHooksModule } from '../common/tx-hooks/tx-hooks.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { OutboxRelayService } from './outbox-relay.service.js';
import { PipelineGauges } from './pipeline-gauges.js';

@Module({
  imports: [QueueModule, TxHooksModule],
  providers: [OutboxRelayService, PipelineGauges],
})
export class OutboxModule {}
