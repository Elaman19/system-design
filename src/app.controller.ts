import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENV, type Env } from './config/env.js';
import { AppService } from './app.service.js';

const MAX_WORK_MS = 5000;

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Slow request holding a DB connection; used to verify graceful shutdown. Opt-in via WORK_ENDPOINT_ENABLED. */
  @Get('work')
  async work(@Query('ms') ms?: string) {
    if (!this.env.WORK_ENDPOINT_ENABLED) throw new NotFoundException();
    const requested = Number(ms);
    const duration = Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : 500,
      MAX_WORK_MS,
    );
    await this.dataSource.query('SELECT pg_sleep($1)', [duration / 1000]);
    return { sleptMs: duration };
  }
}
