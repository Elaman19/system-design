import { pbkdf2Sync } from 'node:crypto';

// ~45 ms of pure CPU per call on the machine the README numbers come from.
// Synchronous on purpose: this is the code that blocks the event loop.
export const ITERATIONS = Number(process.env.HASH_ITERATIONS ?? 20_000);

export function hash(input: string): string {
  return pbkdf2Sync(input, 'salt', ITERATIONS, 64, 'sha512').toString('hex');
}
