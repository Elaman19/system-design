// End-to-end checks against real child processes; Linux /proc is also used by bench.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const children = (pid) =>
  readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
async function scenario(name, test, occupied = false, extra = {}) {
  const reservation = await port();
  const portNumber = reservation.address().port;
  if (!occupied) await new Promise((resolve) => reservation.close(resolve));
  const server = spawn(process.execPath, ['dist/cluster.js'], {
    detached: true,
    env: {
      ...process.env,
      PORT: String(portNumber),
      WEB_CONCURRENCY: '2',
      SHUTDOWN_TIMEOUT_MS: '500',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let status;
  server.stdout.on('data', (data) => {
    output += data;
  });
  server.stderr.on('data', (data) => {
    output += data;
  });
  server.once('error', (error) => {
    status = { error };
  });
  server.once('exit', (code, signal) => {
    status = { code, signal };
  });
  const seen = new Set();
  const workers = () => {
    const pids = children(server.pid);
    pids.forEach((pid) => seen.add(pid));
    return pids;
  };
  const get = async (path) =>
    (
      await fetch(`http://127.0.0.1:${portNumber}${path}`, {
        signal: AbortSignal.timeout(500),
        // cluster distributes connections, so readiness must open new ones.
        headers: { connection: 'close' },
      })
    ).json();
  try {
    await test({
      server,
      workers,
      get,
      status: () => status,
      output: () => output,
    });
    await until(
      () => [...seen].every((pid) => !alive(pid)),
      'no remaining workers',
    );
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await until(() => status, 'primary exit after cleanup');
    if (occupied) await new Promise((resolve) => reservation.close(resolve));
  }
}
async function ready(ctx) {
  await until(async () => {
    if (ctx.status()) throw new Error('primary exited before readiness');
    try {
      return ctx.workers().length === 2 && (await ctx.get('/light')).ok;
    } catch {
      return false;
    }
  }, 'two workers serving HTTP');
  // Both must be listening before stopping either one.
  const responding = new Set();
  await until(async () => {
    try {
      responding.add((await ctx.get('/pid')).pid);
    } catch {
      return false;
    }
    return responding.size === 2;
  }, 'both workers respond');
}
await scenario(
  'uncaughtException and SIGKILL respawn; SIGTERM drains without respawn',
  async (ctx) => {
    await ready(ctx);
    const { crashing } = await ctx.get('/crash');
    await until(
      () =>
        !alive(crashing) &&
        ctx.workers().length === 2 &&
        !ctx.workers().includes(crashing),
      'uncaughtException replacement',
    );
    await ready(ctx);
    const victim = ctx.workers()[0];
    process.kill(victim, 'SIGKILL');
    await until(
      () =>
        !alive(victim) &&
        ctx.workers().length === 2 &&
        !ctx.workers().includes(victim),
      'SIGKILL replacement',
    );
    await ready(ctx);
    assert.equal((await ctx.get('/light')).ok, true);
    ctx.server.kill('SIGTERM');
    await until(() => ctx.status(), 'graceful exit');
    assert.deepEqual(ctx.status(), { code: 0, signal: null });
    assert.ok(
      !ctx.output().split('SIGTERM:')[1].includes('forking a replacement'),
    );
  },
);
await scenario(
  'SIGSTOP worker is killed after shutdown timeout; exit 1',
  async (ctx) => {
    await ready(ctx);
    process.kill(ctx.workers()[0], 'SIGSTOP');
    const start = Date.now();
    ctx.server.kill('SIGTERM');
    await until(() => ctx.status(), 'forced exit');
    assert.deepEqual(ctx.status(), { code: 1, signal: null });
    assert.ok(Date.now() - start >= 500);
    assert.match(ctx.output(), /sending SIGKILL/);
  },
);
await scenario(
  'occupied port stops crash loop; exit 1',
  async (ctx) => {
    await until(() => {
      if (!ctx.status()) ctx.workers();
      return ctx.status();
    }, 'crash loop exit');
    assert.deepEqual(ctx.status(), { code: 1, signal: null });
    assert.match(ctx.output(), /5 workers in a row/);
    assert.equal(
      (ctx.output().match(/forking a replacement/g) ?? []).length,
      4,
    );
  },
  true,
);
await scenario('SIGINT drains workers; exit 0', async (ctx) => {
  await ready(ctx);
  ctx.server.kill('SIGINT');
  await until(() => ctx.status(), 'SIGINT exit');
  assert.deepEqual(ctx.status(), { code: 0, signal: null });
});
for (const env of [{ WEB_CONCURRENCY: '0' }, { SHUTDOWN_TIMEOUT_MS: 'bad' }]) {
  await scenario(
    `invalid config ${JSON.stringify(env)} fails`,
    async (ctx) => {
      await until(() => ctx.status(), 'validation exit');
      assert.deepEqual(ctx.status(), { code: 1, signal: null });
      assert.match(ctx.output(), /must be a positive integer/);
    },
    false,
    env,
  );
}
console.log('all checks passed');
