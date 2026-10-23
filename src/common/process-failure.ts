import { Global, Injectable, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * What a background process does when it hits a failure it cannot work around, such as a
 * consumer that stopped reading: log it and end the process, so that the supervisor
 * (Compose `restart: unless-stopped`) starts a fresh one. A process that only logs and
 * stays up looks healthy and does nothing.
 *
 * How the process ends is the entry point's business (`runContext` sets the handler);
 * without a handler, as in tests, a failure is only logged.
 */
@Injectable()
export class ProcessFailure {
  private handler?: () => void;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProcessFailure.name);
  }

  onFatal(handler: () => void) {
    this.handler = handler;
  }

  fatal(error: unknown, message: string) {
    this.logger.fatal({ err: error }, message);
    this.handler?.();
  }
}

@Global()
@Module({ providers: [ProcessFailure], exports: [ProcessFailure] })
export class ProcessFailureModule {}
