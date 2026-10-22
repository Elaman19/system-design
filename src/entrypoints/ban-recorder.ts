import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module.js';
import { DatabaseModule } from '../db/database.module.js';
import { BanRecorderModule } from '../bans/ban-recorder.module.js';
import { runContext } from './run-context.js';

// ip-bans -> Postgres and the alert job.
@Module({ imports: [CoreModule, DatabaseModule, BanRecorderModule] })
class Process {}

await runContext(Process);
