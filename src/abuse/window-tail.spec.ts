import { WindowTail } from './window-tail.js';

const at = (offset: bigint) => ({ offset, leaderEpoch: 3 });

describe('WindowTail', () => {
  it('has nothing to resume from before any event', () => {
    expect(new WindowTail(1000).start(0)).toBeUndefined();
  });

  it('resumes from the oldest event still inside the window of the newest one', () => {
    const tail = new WindowTail(1000);
    tail.add(0, 0, at(10n));
    tail.add(0, 400, at(11n));
    tail.add(0, 900, at(12n));
    expect(tail.start(0)).toEqual({ offset: 10n, leaderEpoch: 3 });

    // 1000 is exactly one window after 0: the event at 0 has left.
    tail.add(0, 1000, at(13n));

    expect(tail.start(0)).toEqual({ offset: 11n, leaderEpoch: 3 });
  });

  it('keeps the whole tail while the partition is quiet: the window of the last event is what a restart needs', () => {
    const tail = new WindowTail(1000);
    tail.add(0, 0, at(1n));
    tail.add(0, 10, at(2n));

    expect(tail.start(0)).toEqual({ offset: 1n, leaderEpoch: 3 });
  });

  it('keeps partitions apart: another partition moving on does not release this one', () => {
    const tail = new WindowTail(1000);
    tail.add(0, 0, at(1n));
    tail.add(1, 50_000, at(7n));

    expect(tail.start(0)).toEqual({ offset: 1n, leaderEpoch: 3 });
    expect(tail.start(1)).toEqual({ offset: 7n, leaderEpoch: 3 });
  });

  it('an event that arrives late does not move the window back and is released with the rest', () => {
    const tail = new WindowTail(1000);
    tail.add(0, 5000, at(1n));
    tail.add(0, 100, at(2n)); // older than the window of the newest, but behind it in offset order
    tail.add(0, 5500, at(3n));
    expect(tail.start(0)).toEqual({ offset: 1n, leaderEpoch: 3 });

    tail.add(0, 7000, at(4n));

    expect(tail.start(0)).toEqual({ offset: 4n, leaderEpoch: 3 });
  });
});
