// Usage: node scripts/load.mjs [url] [concurrency]
// Sends /work requests over fresh connections until the server goes away.
// Exit code 1 if any request was cut off mid-flight (ECONNRESET etc.) or
// answered with a non-2xx status (e.g. 500 because the DB closed too early).
// Only ECONNREFUSED after the first response counts as "server is gone"; any
// other error (including ECONNRESET) is a broken request. Exit 1 also if no
// request ever succeeded. Note: Docker's port proxy may reset connections once
// the listener closes; run against the app directly for a strict result.
import http from 'node:http';

const base = process.argv[2] ?? 'http://localhost:3000';
const concurrency = Number(process.argv[3] ?? 5);
const stats = { ok: 0, non2xx: 0, refused: 0, broken: 0 };
let stopping = false;
const started = () => stats.ok + stats.non2xx > 0;

function once() {
  return new Promise((resolve) => {
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
      // Strict: only ECONNREFUSED after load started means "server is gone".
      // ECONNRESET is never excused by timing, it is indistinguishable from a
      // server that accepted the request and dropped it.
      if (started() && err.code === 'ECONNREFUSED') {
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
