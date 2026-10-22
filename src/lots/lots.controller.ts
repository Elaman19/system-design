import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { clientIp } from '../common/client-ip.js';
import { ViewEventsPublisher } from '../clickstream/view-events.publisher.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  catalogSchema,
  createLotSchema,
  type Catalog,
  priceSchema,
  publicationSchema,
  stockSchema,
  type CreateLot,
  type Price,
  type Publication,
  type Stock,
} from './lots.schemas.js';
import { LotsService } from './lots.service.js';

@Controller('lots')
export class LotsController {
  constructor(
    private readonly lots: LotsService,
    private readonly views: ViewEventsPublisher,
  ) {}

  @Get()
  catalog(@Query(new ZodValidationPipe(catalogSchema)) query: Catalog) {
    return this.lots.catalog(query);
  }

  /** The lot card. Every view of a published lot becomes an event in Kafka (fire and forget). */
  @Get(':id')
  async card(@Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    const lot = await this.lots.card(id);
    this.views.record({
      viewId: randomUUID(),
      lotId: lot.id,
      ip: clientIp(ip),
      userId: null,
      viewedAt: new Date().toISOString(),
    });
    return lot;
  }

  @Post()
  create(@Body(new ZodValidationPipe(createLotSchema)) body: CreateLot) {
    return this.lots.create(body);
  }

  @Patch(':id/publication')
  setPublication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(publicationSchema)) body: Publication,
  ) {
    return this.lots.setPublication(id, body);
  }

  @Patch(':id/stock')
  setStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(stockSchema)) body: Stock,
  ) {
    return this.lots.setStock(id, body);
  }

  @Patch(':id/price')
  changePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(priceSchema)) body: Price,
  ) {
    return this.lots.changePrice(id, body);
  }
}
