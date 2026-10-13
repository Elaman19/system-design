import { Module } from '@nestjs/common';
import { TxHooks } from './tx-hooks.js';

@Module({ providers: [TxHooks], exports: [TxHooks] })
export class TxHooksModule {}
