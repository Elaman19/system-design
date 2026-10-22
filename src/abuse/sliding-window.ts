/**
 * Views per key within the last `windowMs`, measured on the events' own timestamps,
 * not on the wall clock: a detector catching up on an hour-old backlog counts the views
 * of that hour as they happened, not all at once.
 *
 * The window of a key ends at its newest view. Events of one IP arrive nearly in order
 * (one partition), so inserting keeps the list sorted and costs O(1) in the usual case.
 */
export class SlidingWindow {
  private readonly times = new Map<string, number[]>();
  private newest = 0;

  constructor(private readonly windowMs: number) {}

  /** Records a view at `at` (ms) and returns how many views the key has in its window. */
  add(key: string, at: number): number {
    const list = this.times.get(key) ?? [];
    this.times.set(key, list);
    if (list.length === 0 || at >= list[list.length - 1]) {
      list.push(at);
    } else {
      list.splice(list.findLastIndex((t) => t <= at) + 1, 0, at);
    }
    this.newest = Math.max(this.newest, at);
    const edge = list[list.length - 1] - this.windowMs;
    let expired = 0;
    while (list[expired] <= edge) expired++;
    list.splice(0, expired);
    return list.length;
  }

  /** Forgets keys whose newest view is out of the window of the newest event seen. */
  prune() {
    for (const [key, list] of this.times) {
      if (list[list.length - 1] <= this.newest - this.windowMs) {
        this.times.delete(key);
      }
    }
  }

  get size() {
    return this.times.size;
  }
}
