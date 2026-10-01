// Variant 2: node:cluster. The primary only forks and supervises; every worker
// is a full copy of the app, and the primary hands connections out round-robin.
import cluster from 'node:cluster';
import { bootstrap } from './server.js';

if (cluster.isPrimary) {
  const count = Number(process.env.WEB_CONCURRENCY ?? 1);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`WEB_CONCURRENCY must be a positive integer, got "${process.env.WEB_CONCURRENCY}"`);
  }

  let shuttingDown = false;

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) {
      // cluster.workers drops a worker before its last 'exit' event fires.
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        console.log('all workers stopped, primary exiting');
        process.exit(0);
      }
      return;
    }
    console.warn(`worker ${worker.process.pid} died (${signal ?? code}), forking a replacement`);
    cluster.fork();
  });

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: stopping ${Object.keys(cluster.workers ?? {}).length} workers, no restarts`);
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill('SIGTERM');
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  for (let i = 0; i < count; i++) cluster.fork();
  console.log(`primary ${process.pid} started ${count} workers`);
} else {
  await bootstrap();
}
