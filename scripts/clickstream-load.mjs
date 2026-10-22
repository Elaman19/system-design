// Usage: node scripts/clickstream-load.mjs [--url http://localhost:3000] [--total 100000]
//        [--concurrency 50] [--ips 2000] [--ip 203.0.113.7]
//
// Generates lot-card views (GET /lots/:id) for the click stream. By default views come
// from a pool of --ips different addresses, spread so that no address comes near 300
// views a minute: this is load, not abuse. With --ip every view comes from one address:
// the abuse detector bans it after 300 views in a minute, and the script shows the
// first 429.
//
// The visitor's address is sent in X-Forwarded-For, which the API honours only when
// TRUST_PROXY is set (the Compose stack does, see docker-compose.yml).
import http from 'node:http';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const base = arg('url', 'http://localhost:3000');
const total = Number(arg('total', 100_000));
const concurrency = Number(arg('concurrency', 50));
const ipCount = Number(arg('ips', 2000));
const fixedIp = arg('ip', undefined);

const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      base + path,
      {
        method,
        agent,
        headers: {
          ...headers,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const json = async (method, path, body) => {
  const res = await request(method, path, { body });
  if (res.status >= 300)
    throw new Error(`${method} ${path} -> ${res.status} ${res.text}`);
  return JSON.parse(res.text);
};

// Published lots to look at; make a few if the catalog is empty.
let lots = (await json('GET', '/lots?limit=100')).items.map((l) => l.id);
if (lots.length === 0) {
  const seller = await json('POST', '/companies', {
    name: 'Load seller',
    email: `load-${Date.now()}@example.com`,
  });
  for (let i = 0; i < 20; i++) {
    const lot = await json('POST', '/lots', {
      sellerId: seller.id,
      title: `Load lot ${i}`,
      price: 100_000,
      stock: 10,
    });
    await json('PATCH', `/lots/${lot.id}/publication`, { published: true });
    lots.push(lot.id);
  }
}

const ipOf = (n) =>
  fixedIp ?? `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
const stats = { ok: 0, banned: 0, other: 0, failed: 0 };
let sent = 0;
let firstBanAt;
const started = Date.now();

async function worker() {
  while (sent < total) {
    const n = sent++;
    try {
      const res = await request('GET', `/lots/${lots[n % lots.length]}`, {
        headers: { 'x-forwarded-for': ipOf(n % ipCount) },
      });
      if (res.status === 200) stats.ok++;
      else if (res.status === 429) {
        stats.banned++;
        firstBanAt ??= n + 1;
      } else stats.other++;
    } catch {
      stats.failed++;
    }
    if ((n + 1) % 10_000 === 0) console.log(`${n + 1} views sent`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const seconds = (Date.now() - started) / 1000;
console.log(
  JSON.stringify({
    total,
    ...stats,
    firstBanAtRequest: firstBanAt,
    seconds,
    rps: Math.round(total / seconds),
  }),
);
agent.destroy();
process.exit(stats.failed + stats.other > 0 ? 1 : 0);
