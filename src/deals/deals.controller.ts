import { Body, Controller, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DealsService } from './deals.service.js';
import { purchaseSchema, type Purchase } from './deals.schemas.js';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Post()
  purchase(@Body(new ZodValidationPipe(purchaseSchema)) body: Purchase) {
    return this.deals.purchase(body);
  }
}
