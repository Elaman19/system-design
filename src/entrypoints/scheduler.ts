import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { runContext } from './run-context.js';

// Daily report timer. Run exactly one copy.
@Module({ imports: [CoreModule, SchedulerModule] })
class Process {}

await runContext(Process);
