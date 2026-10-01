// Piscina task: the same synchronous hash, but executed on a worker thread,
// so it blocks that thread's event loop instead of the main one.
import { hash } from './hash.js';

export default function task(input: string): string {
  return hash(input);
}
