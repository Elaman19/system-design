import { Module } from '@nestjs/common';
import { TxHooksModule } from '../common/tx-hooks/tx-hooks.module.js';
import { LotsController } from './lots.controller.js';
import { LotsService } from './lots.service.js';

@Module({
  imports: [TxHooksModule],
  controllers: [LotsController],
  providers: [LotsService],
})
export class LotsModule {}
