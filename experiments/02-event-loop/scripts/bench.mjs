// Linux-only benchmark. The load generator stays outside the measured container.
import autocannon from 'autocannon';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, release } from 'node:os';
import { promisify } from 'node:util';
import { renderResults } from './results.mjs';

const exec = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function positive(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}
const DURATION = positive('DURATION', 15);
const HEAVY_CONN = positive('HEAVY_CONN', 4);
const LIGHT_CONN = positive('LIGHT_CONN', 20);
const RUNS = positive('RUNS', 3);
const PORT = positive('PORT', 3100);
const engine = process.env.CONTAINER_ENGINE ?? 'docker';
const image = `event-loop-bench:${process.pid}`;
const filters = process.argv.slice(2);
// Partial and quick runs must not overwrite the published full benchmark.
const output =
  process.env.RESULTS_FILE ??
  (filters.length ||
  RUNS !== 3 ||
  DURATION !== 15 ||
  HEAVY_CONN !== 4 ||
  LIGHT_CONN !== 20 ||
  process.env.POOL_SIZE !== undefined
    ? 'results.local.json'
    : 'results.json');
const variants = [
  {
    name: 'baseline: 1 process, no heavy load',
    entry: 'dist/main.js',
    heavy: null,
  },
  { name: '1. one process', entry: 'dist/main.js', heavy: '/heavy' },
  ...[1, 2, 4].map((workers) => ({
    name: `2. cluster, ${workers} worker${workers > 1 ? 's' : ''}`,
    entry: 'dist/cluster.js',
    workers,
    heavy: '/heavy',
  })),
  {
    name: '3. worker_threads (piscina)',
    entry: 'dist/main.js',
    heavy: '/heavy-pool',
  },
  ...[1, 4].flatMap((quota) => [
    {
      name: `docker --cpus=${quota}: 1 process`,
      entry: 'dist/main.js',
      heavy: '/heavy',
      quota,
    },
    {
      name: `docker --cpus=${quota}: cluster, 4 workers`,
      entry: 'dist/cluster.js',
      workers: 4,
      heavy: '/heavy',
      quota,
    },
    {
      name: `docker --cpus=${quota}: worker_threads`,
      entry: 'dist/main.js',
      heavy: '/heavy-pool',
      quota,
    },
  ]),
].filter((v) => filters.every((word) => v.name.includes(word)));
if (!variants.length)
  throw new Error(`No variants match: ${filters.join(' ')}`);

function treeRssMb(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  let kb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
  for (const child of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
    .split(' ')
    .filter(Boolean)) {
    try {
      kb += treeRssMb(Number(child)) * 1024;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return kb / 1024;
}

async function assertPortFree() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(PORT, resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}

let cleanup = async () => {};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    try {
      await cleanup();
    } finally {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  });
}
async function run(v) {
  await assertPortFree();
  const env = {
    PORT: String(PORT),
    WEB_CONCURRENCY: String(v.workers ?? 1),
    SHUTDOWN_TIMEOUT_MS: '10000',
  };
  if (process.env.POOL_SIZE !== undefined)
    env.POOL_SIZE = String(positive('POOL_SIZE', 1));
  let pid;
  let sampler;
  let memoryError;
  let peakRss = 0;
  let command;
  let startupError;
  let ended = false;
  let log = '';
  try {
    if (v.quota) {
      const name = `event-loop-bench-${process.pid}`;
      cleanup = async () => {
        await exec(engine, ['stop', '--time', '12', name]).catch(() => {});
        await exec(engine, ['rm', '--force', name]).catch(() => {});
      };
      command = [
        engine,
        'run',
        '--detach',
        '--rm',
        '--name',
        name,
        '--network',
        'host',
        `--cpus=${v.quota}`,
        ...Object.entries(env).flatMap(([key, value]) => [
          '--env',
          `${key}=${value}`,
        ]),
        image,
        'node',
        v.entry,
      ];
      await exec(command[0], command.slice(1));
      pid = Number(
        (
          await exec(engine, ['inspect', '--format', '{{.State.Pid}}', name])
        ).stdout.trim(),
      );
      if (
        !pid ||
        !readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(v.entry)
      ) {
        throw new Error(
          'Container Node process is not visible in host /proc; use a local Linux engine',
        );
      }
    } else {
      command = [process.execPath, v.entry];
      const server = spawn(command[0], command.slice(1), {
        env: { ...process.env, ...env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      server.stdout.on('data', (data) => {
        log = (log + data).slice(-8000);
      });
      server.stderr.on('data', (data) => {
        log = (log + data).slice(-8000);
      });
      server.once('error', (error) => {
        startupError = error;
        ended = true;
      });
      server.once('exit', () => {
        ended = true;
      });
      pid = server.pid;
      cleanup = async () => {
        if (!pid) return;
        try {
          process.kill(-pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        for (let i = 0; !ended && i < 120; i++) await sleep(100);
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      };
    }
    let ready = false;
    for (let i = 0; i < 600; i++) {
      if (ended)
        throw (
          startupError ??
          new Error(`${v.name}: exited before readiness\n${log}`)
        );
      try {
        ready = (
          await fetch(`http://localhost:${PORT}/light`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok;
      } catch {}
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error(`${v.name}: server did not start\n${log}`);
    await autocannon({
      url: `http://localhost:${PORT}${v.heavy ?? '/light'}`,
      connections: 2,
      amount: 20,
    });
    const runtime = await (
      await fetch(`http://localhost:${PORT}/runtime`, {
        signal: AbortSignal.timeout(2000),
      })
    ).json();
    peakRss = treeRssMb(pid);
    sampler = setInterval(() => {
      try {
        peakRss = Math.max(peakRss, treeRssMb(pid));
      } catch (error) {
        memoryError = error;
      }
    }, 250);
    const load = (path, connections) =>
      autocannon({
        url: `http://localhost:${PORT}${path}`,
        connections,
        duration: DURATION,
        timeout: 10,
      });
    const [light, heavy] = await Promise.all([
      load('/light', LIGHT_CONN),
      v.heavy ? load(v.heavy, HEAVY_CONN) : null,
    ]);
    if (memoryError) throw memoryError;
    return {
      variant: v.name,
      command,
      env,
      cpuQuota: v.quota ?? null,
      runtime,
      lightRps: Math.round(light.requests.average),
      lightP50: light.latency.p50,
      lightP99: light.latency.p99,
      heavyRps: heavy ? Number(heavy.requests.average.toFixed(1)) : null,
      heavyP99: heavy?.latency.p99 ?? null,
      // autocannon errors already includes timeouts. non2xx is separate.
      errors: light.errors + (heavy?.errors ?? 0),
      timeouts: light.timeouts + (heavy?.timeouts ?? 0),
      non2xx: light.non2xx + (heavy?.non2xx ?? 0),
      peakRssMb: Math.round(peakRss),
    };
  } finally {
    clearInterval(sampler);
    await cleanup();
    cleanup = async () => {};
  }
}

const commit = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
const diff = (await exec('git', ['status', '--porcelain'])).stdout;
let container = null;
if (variants.some((v) => v.quota)) {
  console.error(`Building ${image} with ${engine}...`);
  await exec(engine, ['build', '--tag', image, '.'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  container = {
    engine,
    version: (await exec(engine, ['--version'])).stdout.trim(),
    imageId: (
      await exec(engine, ['image', 'inspect', '--format', '{{.Id}}', image])
    ).stdout.trim(),
  };
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
const runs = [];
for (const v of variants) {
  const vr = [];
  for (let i = 1; i <= RUNS; i++) {
    console.error(`running: ${v.name} (${i}/${RUNS})`);
    vr.push(await run(v));
  }
  runs.push(...vr);
  const row = { variant: v.name };
  for (const key of [
    'lightRps',
    'lightP50',
    'lightP99',
    'heavyRps',
    'heavyP99',
    'peakRssMb',
  ])
    row[key] = vr[0][key] === null ? null : median(vr.map((r) => r[key]));
  row.lightP99Range = `${Math.min(...vr.map((r) => r.lightP99))}–${Math.max(...vr.map((r) => r.lightP99))}`;
  for (const key of ['errors', 'timeouts', 'non2xx'])
    row[key] = vr.reduce((sum, r) => sum + r[key], 0);
  results.push(row);
}
const report = {
  schemaVersion: 2,
  date: new Date().toISOString(),
  node: process.version,
  machine: `${cpus().length} CPUs (${cpus()[0]?.model})`,
  kernel: release(),
  source: { commit, dirty: Boolean(diff.trim()) },
  command: [process.execPath, ...process.argv.slice(1)],
  container,
  RUNS,
  DURATION,
  HEAVY_CONN,
  LIGHT_CONN,
  results,
  runs,
};
console.log(renderResults(report));
// A failed run leaves the previous report intact.
writeFileSync(`${output}.tmp`, JSON.stringify(report, null, 2) + '\n');
renameSync(`${output}.tmp`, output);
console.error(`Saved ${output}`);
