import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { databaseConfig } from './config/database.config.js';
import { loggerConfig } from './config/logger.config.js';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig()),
    TypeOrmModule.forRootAsync({ useFactory: databaseConfig }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
