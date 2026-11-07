import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';

/** What the shutdown needs of the OpenTelemetry SDK. */
export interface TracingSdk {
  shutdown(): Promise<void>;
}

// The SDK is started by src/entrypoints/tracing.ts (`node --import`) before any module of
// the application is loaded, so it cannot be a Nest provider; it is handed over here.
const SDK = Symbol.for('marketplace.tracing-sdk');
type Holder = { [SDK]?: TracingSdk };

export function setTracingSdk(sdk: TracingSdk | undefined) {
  (globalThis as Holder)[SDK] = sdk;
}

/**
 * Spans are exported in batches every few seconds. The processes end with process.exit()
 * after Nest's shutdown hooks, which would drop the last batch: flush it here first.
 * Without `--import` (tests, `npm run start:dev`) there is no SDK and nothing to do.
 */
@Injectable()
export class TracingShutdown implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await (globalThis as Holder)[SDK]?.shutdown();
  }
}

@Module({ providers: [TracingShutdown] })
export class TracingModule {}
