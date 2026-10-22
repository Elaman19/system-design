import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module.js';
import { ArchiverModule } from '../clickstream/archiver.module.js';
import { runContext } from './run-context.js';

// lot-views -> S3.
@Module({ imports: [CoreModule, ArchiverModule] })
class Process {}

await runContext(Process);
