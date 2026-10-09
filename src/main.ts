import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

async function bootstrap() {
  // Fail fast: validate config before anything connects or listens.
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(
      JSON.stringify({ level: 'fatal', msg: (error as Error).message }),
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
await bootstrap();
