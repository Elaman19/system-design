import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import pino from 'pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { baseLogOptions } from './config/logger.config.js';
import { nestLogger } from './config/nest-logger.js';

// quiet: dotenv's banner is unstructured text; stdout must stay JSON-only.
config({ quiet: true });

async function bootstrap() {
  // Fail fast: validate config before anything connects or listens.
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    pino().fatal((error as Error).message);
    process.exit(1);
  }

  // Startup (module init, DB connect retries, crashes) is logged as JSON too.
  const logger = pino(baseLogOptions(env));
  try {
    const app = await NestFactory.create(AppModule, {
      logger: nestLogger(logger),
    });
    app.useLogger(app.get(Logger));
    // useProcessExit: exit via process.exit() so pino flushes the last hook logs
    // (the default re-raises the signal and can drop buffered stdout).
    app.enableShutdownHooks(undefined, { useProcessExit: true });
    await app.listen(env.PORT);
  } catch (error) {
    logger.fatal({ err: error }, 'application failed to start');
    process.exit(1);
  }
}
await bootstrap();
