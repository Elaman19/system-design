import type { ConnectionOptions } from 'bullmq';

/** BullMQ wants ioredis options, the config holds one URL. */
export function redisConnection(url: string): ConnectionOptions {
  const { hostname, port, username, password, pathname, protocol } = new URL(
    url,
  );
  return {
    host: hostname,
    port: Number(port || 6379),
    username: username || undefined,
    password: password || undefined,
    db: pathname.length > 1 ? Number(pathname.slice(1)) : undefined,
    tls: protocol === 'rediss:' ? {} : undefined,
  };
}
