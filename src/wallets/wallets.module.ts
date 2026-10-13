import { Module } from '@nestjs/common';
import { TxHooksModule } from '../common/tx-hooks/tx-hooks.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [TxHooksModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
