import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module.js';
import { DatabaseModule } from '../db/database.module.js';
import { WorkerModule } from '../worker/worker.module.js';
import { runContext } from './run-context.js';

// Consumes the mail queue: receipts, ban alerts, the daily report.
@Module({ imports: [CoreModule, DatabaseModule, WorkerModule] })
class Process {}

await runContext(Process);
