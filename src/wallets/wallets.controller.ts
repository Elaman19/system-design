import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { depositSchema, type Deposit } from './wallets.schemas.js';
import { WalletsService } from './wallets.service.js';

@Controller('companies')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  /** Administrator: a bank notification arrived, credit this company's wallet. */
  @Post(':id/wallet/deposits')
  deposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(depositSchema)) body: Deposit,
  ) {
    return this.wallets.deposit(id, body);
  }
}
