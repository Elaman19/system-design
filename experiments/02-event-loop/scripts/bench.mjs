// Runs every variant under the same load and prints a Markdown table.
// Load: HEAVY_CONN connections hammer the CPU endpoint while LIGHT_CONN
// connections hit /light at the same time; we report what /light experiences.
import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DURATION = Number(process.env.DURATION ?? 15);
const HEAVY_CONN = Number(process.env.HEAVY_CONN ?? 4);
const LIGHT_CONN = Number(process.env.LIGHT_CONN ?? 20);
const RUNS = Number(process.env.RUNS ?? 3);
const PORT = 3100;

const variants = [
  { name: 'baseline: 1 process, no heavy load', entry: 'dist/main.js', heavy: null },
  { name: '1. one process', entry: 'dist/main.js', heavy: '/heavy' },
  { name: '2. cluster, 1 worker', entry: 'dist/cluster.js', env: { WEB_CONCURRENCY: '1' }, heavy: '/heavy' },
  { name: '2. cluster, 2 workers', entry: 'dist/cluster.js', env: { WEB_CONCURRENCY: '2' }, heavy: '/heavy' },
  { name: '2. cluster, 4 workers', entry: 'dist/cluster.js', env: { WEB_CONCURRENCY: '4' }, heavy: '/heavy' },
  // taskset pins the whole process tree to one core, like `docker run --cpuset-cpus=0`.
  { name: '2. cluster, 4 workers, 1 CPU', entry: 'dist/cluster.js', env: { WEB_CONCURRENCY: '4' }, heavy: '/heavy', pin: '0' },
  { name: '3. worker_threads (piscina)', entry: 'dist/main.js', heavy: '/heavy-pool' },
];

// Resident memory of a process plus all of its descendants, in MB (Linux /proc).
function treeRssMb(pid) {
  let kb = 0;
  const visit = (p) => {
    try {
      kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0);
      for (const tid of readFileSync(`/proc/${p}/task/${p}/children`, 'utf8').split(' ').filter(Boolean)) visit(tid);
    } catch {
      // process exited between reads
    }
  };
  visit(pid);
  return kb / 1024;
}

async function waitForServer() {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/light`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

const load = (path, connections) =>
  autocannon({ url: `http://localhost:${PORT}${path}`, connections, duration: DURATION });

async function run(v) {
  const [cmd, args] = v.pin ? ['taskset', ['-c', v.pin, 'node', v.entry]] : ['node', [v.entry]];
  const server = spawn(cmd, args, { env: { ...process.env, ...v.env, PORT: String(PORT) }, stdio: 'ignore' });
  const exited = new Promise((r) => server.once('exit', r));
  // Never leave a server behind if the bench itself dies.
  const killOnExit = () => server.kill('SIGTERM');
  process.once('exit', killOnExit);
  // If the port is still taken the new server dies at once; fail instead of
  // silently benchmarking the old one.
  await Promise.race([waitForServer(), exited.then(() => Promise.reject(new Error(`${v.name}: server exited early`)))]);
  // Warm-up: JIT, and for piscina the lazy pool creation.
  await autocannon({ url: `http://localhost:${PORT}${v.heavy ?? '/light'}`, connections: 2, amount: 20 });

  let peakRss = 0;
  const sampler = setInterval(() => (peakRss = Math.max(peakRss, treeRssMb(server.pid))), 250);
  const [light, heavy] = await Promise.all([load('/light', LIGHT_CONN), v.heavy ? load(v.heavy, HEAVY_CONN) : null]);
  clearInterval(sampler);

  server.kill('SIGTERM');
  await exited;
  process.off('exit', killOnExit);

  return {
    variant: v.name,
    lightRps: Math.round(light.requests.average),
    lightP50: light.latency.p50,
    lightP99: light.latency.p99,
    heavyRps: heavy ? Number(heavy.requests.average.toFixed(1)) : null,
    heavyP99: heavy ? heavy.latency.p99 : null,
    errors: light.errors + light.timeouts + (heavy ? heavy.errors + heavy.timeouts : 0),
    peakRssMb: Math.round(peakRss),
  };
}

// Repeat each variant: with keep-alive, cluster balances connections, not
// requests, so one run depends on which worker the heavy connections hit.
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const range = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}`;

const runs = [];
const results = [];
for (const v of variants) {
  const vr = [];
  for (let i = 1; i <= RUNS; i++) {
    process.stderr.write(`running: ${v.name} (${i}/${RUNS})\n`);
    vr.push(await run(v));
  }
  runs.push(...vr);
  const m = (key) => (vr[0][key] === null ? null : median(vr.map((r) => r[key])));
  results.push({
    variant: v.name,
    lightRps: m('lightRps'),
    lightP50: m('lightP50'),
    lightP99: m('lightP99'),
    lightP99Range: range(vr.map((r) => r.lightP99)),
    heavyRps: m('heavyRps'),
    heavyP99: m('heavyP99'),
    errors: vr.reduce((sum, r) => sum + r.errors, 0),
    peakRssMb: m('peakRssMb'),
  });
}

const rows = [
  `Median of ${RUNS} runs, ${DURATION} s each, ${HEAVY_CONN} heavy + ${LIGHT_CONN} light connections, Node ${process.version}`,
  '',
  '| Variant | /light RPS | /light p50, ms | /light p99, ms (min–max) | heavy RPS | heavy p99, ms | errors | peak RSS, MB |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map((r) =>
    `| ${r.variant} | ${r.lightRps} | ${r.lightP50} | ${r.lightP99} (${r.lightP99Range}) | ${r.heavyRps ?? '-'} | ${r.heavyP99 ?? '-'} | ${r.errors} | ${r.peakRssMb} |`,
  ),
];
console.log(rows.join('\n'));
writeFileSync('results.json', JSON.stringify({ date: new Date().toISOString(), node: process.version, RUNS, DURATION, HEAVY_CONN, LIGHT_CONN, results, runs }, null, 2) + '\n');
