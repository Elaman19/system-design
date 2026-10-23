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

describe('background processes in compose', () => {
  const compose = readFileSync(new URL('docker-compose.yml', root), 'utf8');
  /** The text of one top-level service: from its header to the next service. */
  const service = (name: string) => {
    const start = compose.indexOf(`\n  ${name}:\n`);
    const rest = compose.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n|\nvolumes:/);
    return rest.slice(0, next + 1);
  };

  it('runs the scheduler as a single copy: no replicas, no scale', () => {
    expect(compose).not.toMatch(/replicas:|scale:/);
    expect(service('scheduler')).toContain('dist/entrypoints/scheduler.js');
  });

  it('Redis keeps the queue on a volume with an append-only file synced on every command: an accepted job survives a restart', () => {
    const redis = service('redis');

    expect(redis).toContain("'--appendonly', 'yes'");
    expect(redis).toContain("'--appendfsync', 'always'");
    expect(redis).toMatch(/redis-data:\/data/);
  });

  it('the API does not wait for Redis, Kafka or the mail catcher: it must serve without them', () => {
    const app = service('app');
    // Sanity check of the slice itself: it does contain what the API does wait for.
    expect(app).toMatch(/\n {6}postgres:\n/);
    for (const dependency of ['redis', 'kafka', 'mailpit']) {
      expect(app).not.toMatch(new RegExp(`\\n {6}${dependency}:\\n`));
    }
  });

  it.each([
    'outbox-relay',
    'worker',
    'clickstream-archiver',
    'abuse-detector',
    'ban-recorder',
    'scheduler',
  ])('%s is a container of its own with its own entry point', (name) => {
    expect(service(name)).toContain(`dist/entrypoints/${name}.js`);
  });
});
