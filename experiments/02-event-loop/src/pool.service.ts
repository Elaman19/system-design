import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { availableParallelism } from 'node:os';
import { Piscina } from 'piscina';

@Injectable()
export class PoolService implements OnApplicationShutdown {
  // Created lazily: variants 1 and 2 never call /heavy-pool, and an eager pool
  // would add idle threads to their memory numbers.
  private pool?: Piscina<string, string>;

  run(input: string): Promise<string> {
    this.pool ??= new Piscina({
      filename: new URL('./hash.worker.js', import.meta.url).href,
      maxThreads: Number(process.env.POOL_SIZE ?? availableParallelism()),
    });
    return this.pool.run(input);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.destroy();
  }
}
