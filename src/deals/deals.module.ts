import { Module } from '@nestjs/common';
import { TxHooksModule } from '../common/tx-hooks/tx-hooks.module.js';
import { DealsController } from './deals.controller.js';
import { DealsService } from './deals.service.js';

@Module({
  imports: [TxHooksModule],
  controllers: [DealsController],
  providers: [DealsService],
})
export class DealsModule {}
