// Usage: node scripts/load.mjs [url] [concurrency]
// Sends /work requests over fresh connections until the server goes away.
// Exit code 1 if any request was cut off mid-flight (ECONNRESET etc.) or
// answered with a non-2xx status (e.g. 500 because the DB closed too early).
// Mid-flight = failed after the request had been running for a while. A
// connection rejected right away (refused, or reset instantly by Docker's port
// proxy once the listener is gone) is a normal "server is gone" outcome.
import http from 'node:http';

const base = process.argv[2] ?? 'http://localhost:3000';
const concurrency = Number(process.argv[3] ?? 5);
const stats = { ok: 0, non2xx: 0, refused: 0, broken: 0 };
let stopping = false;
// Reset right after connect is how Docker's port proxy rejects once the
// listener is gone; only ECONNRESET counts, and only once load has started.
const REJECTED_WITHIN_MS = 200;
const started = () => stats.ok + stats.non2xx > 0;

function once() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = http.get(`${base}/work?ms=1000`, { agent: false }, (res) => {
      res.resume();
      res.on('end', () => {
        res.statusCode < 300 ? stats.ok++ : stats.non2xx++;
        resolve();
      });
      res.on('error', () => {
        stats.broken++;
        resolve();
      });
    });
    req.on('error', (err) => {
      if (
        started() &&
        (err.code === 'ECONNREFUSED' ||
          (err.code === 'ECONNRESET' &&
            Date.now() - startedAt < REJECTED_WITHIN_MS))
      ) {
        stats.refused++;
        stopping = true;
      } else {
        stats.broken++;
        stopping = true;
        console.error('cut off mid-flight:', err.code ?? err.message);
      }
      resolve();
    });
  });
}

async function worker() {
  while (!stopping) await once();
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(JSON.stringify(stats));
if (stats.ok === 0) {
  console.error('no request succeeded: load never started (server down?)');
  process.exit(1);
}
process.exit(stats.broken > 0 || stats.non2xx > 0 ? 1 : 0);
