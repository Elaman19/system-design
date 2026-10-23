/**
 * Views per key within the last `windowMs`, measured on the events' own timestamps,
 * not on the wall clock: a detector catching up on an hour-old backlog counts the views
 * of that hour as they happened, not all at once.
 *
 * The window of a key ends at its newest view. Events of one IP arrive nearly in order
 * (one partition), so inserting keeps the list sorted and costs O(1) in the usual case.
 *
 * Time is tracked per partition: Kafka orders events inside a partition only, and a
 * partition that is behind still delivers old events after another one has moved on.
 * A key is forgotten when its own partition has moved a whole window past its last view.
 */
export class SlidingWindow {
  private readonly keys = new Map<
    string,
    { times: number[]; partition: number }
  >();
  private readonly newest = new Map<number, number>();

  constructor(private readonly windowMs: number) {}

  /** Records a view at `at` (ms) and returns how many views the key has in its window. */
  add(key: string, partition: number, at: number): number {
    const entry = this.keys.get(key) ?? { times: [], partition };
    this.keys.set(key, entry);
    entry.partition = partition;
    const { times } = entry;
    if (times.length === 0 || at >= times[times.length - 1]) {
      times.push(at);
    } else {
      times.splice(times.findLastIndex((t) => t <= at) + 1, 0, at);
    }
    this.newest.set(partition, Math.max(this.newest.get(partition) ?? 0, at));
    const edge = times[times.length - 1] - this.windowMs;
    let expired = 0;
    while (times[expired] <= edge) expired++;
    times.splice(0, expired);
    return times.length;
  }

  /** Forgets keys whose newest view is out of the window of the newest event of their partition. */
  prune() {
    for (const [key, { times, partition }] of this.keys) {
      if (
        times[times.length - 1] <=
        this.newest.get(partition)! - this.windowMs
      ) {
        this.keys.delete(key);
      }
    }
  }

  get size() {
    return this.keys.size;
  }
}
