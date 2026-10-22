import { isIP } from 'node:net';

/** `::ffff:203.0.113.7` (IPv4 seen by a dual-stack socket) and `203.0.113.7` are one visitor. */
export const clientIp = (ip: string | undefined) =>
  (ip ?? '').replace(/^::ffff:/i, '');

/**
 * The visitor's address if it is one. Behind a trusted proxy `req.ip` is whatever
 * `X-Forwarded-For` carried, which can be garbage; garbage must never reach a query
 * that casts it to `inet`.
 */
export const validClientIp = (ip: string | undefined) => {
  const address = clientIp(ip);
  return isIP(address) === 0 ? undefined : address;
};
