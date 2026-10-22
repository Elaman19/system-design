import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module.js';
import { DatabaseModule } from '../db/database.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { runContext } from './run-context.js';

// Moves outbox rows into the BullMQ queue.
@Module({ imports: [CoreModule, DatabaseModule, OutboxModule] })
class Process {}

await runContext(Process);
