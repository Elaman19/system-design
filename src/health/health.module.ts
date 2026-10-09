import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { ShutdownService } from './shutdown.service.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [ShutdownService],
})
export class HealthModule {}
