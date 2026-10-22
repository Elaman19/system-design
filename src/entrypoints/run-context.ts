import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import pino from 'pino';
import type { Type } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { baseLogOptions } from '../config/logger.config.js';
import { nestLogger } from '../config/nest-logger.js';

/**
 * Starts one background process: config check, JSON logs, a Nest application context
 * (no HTTP server) and graceful shutdown on SIGTERM. Same steps as src/main.ts.
 */
export async function runContext(root: Type) {
  config({ quiet: true });
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    pino().fatal((error as Error).message);
    process.exit(1);
  }
  const logger = pino(baseLogOptions(env));
  try {
    const app = await NestFactory.createApplicationContext(root, {
      logger: nestLogger(logger),
    });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks(undefined, { useProcessExit: true });
  } catch (error) {
    logger.fatal({ err: error }, 'process failed to start');
    process.exit(1);
  }
}
