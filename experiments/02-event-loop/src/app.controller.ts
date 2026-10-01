import { Controller, Get } from '@nestjs/common';
import { hash } from './hash.js';
import { PoolService } from './pool.service.js';

@Controller()
export class AppController {
  constructor(private readonly pool: PoolService) {}

  // Does nothing: its latency shows how long a request waits for the event loop.
  @Get('light')
  light() {
    return { ok: true };
  }

  // Blocks the event loop for the whole hash.
  @Get('heavy')
  heavy() {
    return { hash: hash('password') };
  }

  // Same work on a worker_threads pool; the main thread only awaits the result.
  @Get('heavy-pool')
  async heavyPool() {
    return { hash: await this.pool.run('password') };
  }

  @Get('pid')
  pid() {
    return { pid: process.pid };
  }

  // Simulates a bug: an exception thrown in a timer callback is outside any
  // request's try/catch, so it is an uncaughtException and kills the process.
  @Get('crash')
  crash() {
    setTimeout(() => {
      throw new Error('boom');
    });
    return { crashing: process.pid };
  }
}
