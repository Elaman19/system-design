import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PoolService } from './pool.service.js';

@Module({
  controllers: [AppController],
  providers: [PoolService],
})
export class AppModule {}
