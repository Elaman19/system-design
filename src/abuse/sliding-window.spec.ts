import { SlidingWindow } from './sliding-window.js';

describe('SlidingWindow', () => {
  it('counts views of a key within the window that ends at its newest view', () => {
    const w = new SlidingWindow(1000);

    expect(w.add('a', 0)).toBe(1);
    expect(w.add('a', 500)).toBe(2);
    expect(w.add('a', 999)).toBe(3);
    // 1000 is exactly one window after 0: the view at 0 has left.
    expect(w.add('a', 1000)).toBe(3);
    expect(w.add('a', 2500)).toBe(1);
  });

  it('keeps keys apart', () => {
    const w = new SlidingWindow(1000);

    w.add('a', 0);

    expect(w.add('b', 0)).toBe(1);
  });

  it('files a late event into its place and counts it, without moving the window back', () => {
    const w = new SlidingWindow(1000);
    w.add('a', 100);
    w.add('a', 900);

    expect(w.add('a', 500)).toBe(3);
    expect(w.add('a', 1200)).toBe(3); // 100 has left, 500 and 900 stay
    // Older than everything stored: still the oldest, and outside the window, so dropped.
    expect(w.add('a', 50)).toBe(3);
  });

  it('forgets keys whose last view is out of the window of the newest event seen', () => {
    const w = new SlidingWindow(1000);
    w.add('old', 0);
    w.add('fresh', 5000);

    w.prune();

    expect(w.size).toBe(1);
    expect(w.add('old', 5100)).toBe(1);
  });

  it('keeps keys that are still inside the window when pruning', () => {
    const w = new SlidingWindow(1000);
    w.add('a', 4500);
    w.add('b', 5000);

    w.prune();

    expect(w.size).toBe(2);
  });
});
