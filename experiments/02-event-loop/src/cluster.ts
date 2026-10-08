// Variant 2: node:cluster. The primary only forks and supervises; every worker
// is a full copy of the app, and the primary hands connections out round-robin.
import cluster from 'node:cluster';
import { bootstrap } from './server.js';

if (cluster.isPrimary) {
  const count = Number(process.env.WEB_CONCURRENCY ?? 1);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `WEB_CONCURRENCY must be a positive integer, got "${process.env.WEB_CONCURRENCY}"`,
    );
  }

  let shuttingDown = false;
  let exitCode = 0;
  let rapidExits = 0;
  const started = new Map<number, number>();
  const timeout = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error('SHUTDOWN_TIMEOUT_MS must be a positive integer');
  }
  const fork = () => {
    const worker = cluster.fork();
    started.set(worker.id, Date.now());
  };
  const shutdown = (reason: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    console.log(
      `${reason}: stopping ${Object.keys(cluster.workers ?? {}).length} workers, no restarts`,
    );
    if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(exitCode);
    for (const worker of Object.values(cluster.workers ?? {}))
      worker?.process.kill('SIGTERM');
    setTimeout(() => {
      exitCode = 1;
      console.error(
        `workers still running after ${timeout} ms, sending SIGKILL`,
      );
      for (const worker of Object.values(cluster.workers ?? {}))
        worker?.process.kill('SIGKILL');
    }, timeout).unref();
  };

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) {
      // cluster.workers drops a worker before its last 'exit' event fires.
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        console.log('all workers stopped, primary exiting');
        process.exit(exitCode);
      }
      return;
    }
    rapidExits =
      Date.now() - started.get(worker.id)! < 5_000 ? rapidExits + 1 : 0;
    started.delete(worker.id);
    if (rapidExits >= 5) {
      shutdown('5 workers in a row died within 5000 ms of start, giving up', 1);
      return;
    }
    console.warn(
      `worker ${worker.process.pid} died (${signal ?? code}), forking a replacement`,
    );
    fork();
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  for (let i = 0; i < count; i++) fork();
  console.log(`primary ${process.pid} started ${count} workers`);
} else {
  await bootstrap();
}
