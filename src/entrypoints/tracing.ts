// Preloaded before any process of the system: `node --import ./dist/entrypoints/tracing.js
// dist/<process>.js` (Compose sets it through NODE_OPTIONS). Instrumentation patches modules
// as they load, so it must run before the application imports Express, pg or ioredis.
//
// Configured by the standard OTel variables: OTEL_EXPORTER_OTLP_ENDPOINT (where spans go),
// OTEL_SDK_DISABLED=true turns it off, OTEL_SERVICE_NAME overrides the service name, which
// is otherwise the process: `app` for dist/main.js, `worker` for dist/entrypoints/worker.js.
// Spans are exported over OTLP/HTTP in batches; an unreachable collector drops them and
// never slows a request down: traces are diagnostics and may be lost, unlike the audit log.
import { register } from 'node:module';
import { basename } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { setTracingSdk } from '../observability/tracing.js';

// ESM: `import` of an instrumented package goes through this loader hook.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

// Probes and scrapes every few seconds would bury the requests worth looking at.
const NOT_TRACED = new Set(['/live', '/ready', '/metrics']);

const script = basename(process.argv[1] ?? 'node', '.js');

const sdk = new NodeSDK({
  serviceName:
    process.env.OTEL_SERVICE_NAME ?? (script === 'main' ? 'app' : script),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req: IncomingMessage) =>
        NOT_TRACED.has(req.url ?? ''),
    }),
    new ExpressInstrumentation(),
    new NestInstrumentation(),
    // requireParentSpan: the relay polls the outbox twice a second; without a parent
    // (an HTTP request, a job) every poll would be a trace of its own.
    new PgInstrumentation({ requireParentSpan: true }),
    new IORedisInstrumentation({ requireParentSpan: true }),
    // Adds trace_id and span_id to every log line written inside a span: from a slow
    // trace to its logs and back.
    new PinoInstrumentation(),
  ],
});
sdk.start();
setTracingSdk(sdk);
