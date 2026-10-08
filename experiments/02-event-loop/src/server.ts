import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  // On SIGTERM: close the HTTP server, destroy the thread pool, then exit.
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
