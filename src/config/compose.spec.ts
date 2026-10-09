import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const root = new URL('../../', import.meta.url);

describe('shutdown timings', () => {
  it('stop_grace_period in compose outlasts drain + timeout from .env.example', () => {
    const compose = readFileSync(new URL('docker-compose.yml', root), 'utf8');
    const example = parse(readFileSync(new URL('.env.example', root)));

    const grace = Number(/stop_grace_period:\s*(\d+)s/.exec(compose)?.[1]);
    const budgetMs =
      Number(example.SHUTDOWN_DRAIN_MS) + Number(example.SHUTDOWN_TIMEOUT_MS);

    expect(grace * 1000).toBeGreaterThan(budgetMs);
  });
});
