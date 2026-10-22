import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module.js';
import { AbuseDetectorModule } from '../abuse/abuse-detector.module.js';
import { runContext } from './run-context.js';

// lot-views -> ip-bans.
@Module({ imports: [CoreModule, AbuseDetectorModule] })
class Process {}

await runContext(Process);
