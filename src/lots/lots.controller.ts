import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  constructor(private readonly lots: LotsService) {}

  @Get()
  catalog(@Query(new ZodValidationPipe(catalogSchema)) query: Catalog) {
    return this.lots.catalog(query);
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
