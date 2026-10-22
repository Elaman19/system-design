import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QueueModule } from '../queue/queue.module.js';
import { DailyReportScheduler } from './daily-report.scheduler.js';

@Module({
  imports: [ScheduleModule.forRoot(), QueueModule],
  providers: [DailyReportScheduler],
})
export class SchedulerModule {}
