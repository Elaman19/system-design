import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CompaniesService } from './companies.service.js';
import {
  createCompanySchema,
  type CreateCompany,
} from './companies.schemas.js';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompany,
  ) {
    return this.companies.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(id);
  }
}
