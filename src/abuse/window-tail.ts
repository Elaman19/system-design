export interface Position {
  offset: bigint;
  leaderEpoch: number;
}

/**
 * Where to restart reading a partition so that the window comes back: the oldest event
 * still inside the window of the partition's newest event. The detector commits this
 * position instead of "after the last handled event", so a restart re-reads the window's
 * worth of views and the counters are rebuilt, not reset to zero.
 *
 * Kept in offset order; an event that arrives out of time order can only keep the position
 * further back, which re-reads a little more and is never wrong.
 */
export class WindowTail {
  private readonly events = new Map<number, (Position & { at: number })[]>();
  private readonly newest = new Map<number, number>();

  constructor(private readonly windowMs: number) {}

  /** Records an event handled at `position` that happened at `at` (ms). */
  add(partition: number, at: number, position: Position) {
    const events = this.events.get(partition) ?? [];
    this.events.set(partition, events);
    events.push({ ...position, at });
    const newest = Math.max(this.newest.get(partition) ?? 0, at);
    this.newest.set(partition, newest);
    let expired = 0;
    while (events[expired].at <= newest - this.windowMs) expired++;
    events.splice(0, expired);
  }

  /** The position to resume from, or undefined when no event of the partition is held. */
  start(partition: number): Position | undefined {
    const first = this.events.get(partition)?.[0];
    return first && { offset: first.offset, leaderEpoch: first.leaderEpoch };
  }
}
