import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { BanRecorderService } from './ban-recorder.service.js';

@Module({ imports: [QueueModule], providers: [BanRecorderService] })
export class BanRecorderModule {}
