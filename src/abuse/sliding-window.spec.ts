import { SlidingWindow } from './sliding-window.js';

describe('SlidingWindow', () => {
  it('counts views of a key within the window that ends at its newest view', () => {
    const w = new SlidingWindow(1000);

    expect(w.add('a', 0, 0)).toBe(1);
    expect(w.add('a', 0, 500)).toBe(2);
    expect(w.add('a', 0, 999)).toBe(3);
    // 1000 is exactly one window after 0: the view at 0 has left.
    expect(w.add('a', 0, 1000)).toBe(3);
    expect(w.add('a', 0, 2500)).toBe(1);
  });

  it('keeps keys apart', () => {
    const w = new SlidingWindow(1000);

    w.add('a', 0, 0);

    expect(w.add('b', 0, 0)).toBe(1);
  });

  it('files a late event into its place and counts it, without moving the window back', () => {
    const w = new SlidingWindow(1000);
    w.add('a', 0, 100);
    w.add('a', 0, 900);

    expect(w.add('a', 0, 500)).toBe(3);
    expect(w.add('a', 0, 1200)).toBe(3); // 100 has left, 500 and 900 stay
    // Older than everything stored: still the oldest, and outside the window, so dropped.
    expect(w.add('a', 0, 50)).toBe(3);
  });

  it('forgets keys whose last view is out of the window of the newest event seen', () => {
    const w = new SlidingWindow(1000);
    w.add('old', 0, 0);
    w.add('fresh', 0, 5000);

    w.prune();

    expect(w.size).toBe(1);
    expect(w.add('old', 0, 5100)).toBe(1);
  });

  it('does not forget a key because another partition has moved on: its own partition is still behind', () => {
    const w = new SlidingWindow(1000);
    w.add('slow', 0, 100);
    w.add('fast', 1, 9000);

    w.prune();

    expect(w.size).toBe(2);
    // The slow partition still delivers views of that minute: they count on top of the first.
    expect(w.add('slow', 0, 600)).toBe(2);
  });

  it('forgets a key once its own partition has moved a whole window past it', () => {
    const w = new SlidingWindow(1000);
    w.add('a', 0, 100);
    w.add('b', 0, 2000);
    w.add('other', 1, 100);

    w.prune();

    expect(w.size).toBe(2); // 'a' is gone, 'b' and the other partition's key stay
    expect(w.add('a', 0, 2100)).toBe(1);
  });

  it('keeps keys that are still inside the window when pruning', () => {
    const w = new SlidingWindow(1000);
    w.add('a', 0, 4500);
    w.add('b', 0, 5000);

    w.prune();

    expect(w.size).toBe(2);
  });
});
