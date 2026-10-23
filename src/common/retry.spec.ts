import { Stoppable, retryUntilDone } from './retry.js';

describe('Stoppable', () => {
  it('sleeps for the given time', async () => {
    const control = new Stoppable();
    const started = Date.now();

    await control.sleep(30);

    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(control.isStopped).toBe(false);
  });

  it('wakes a sleeper when stopped, and does not sleep once stopped', async () => {
    const control = new Stoppable();
    const sleeping = control.sleep(60_000);

    control.stop();
    await sleeping;

    expect(control.isStopped).toBe(true);
    await control.sleep(60_000); // returns at once
  });

  it('can be stopped without anyone sleeping', () => {
    const control = new Stoppable();

    control.stop();

    expect(control.isStopped).toBe(true);
  });
});

describe('retryUntilDone', () => {
  it('returns true after the first success without reporting anything', async () => {
    const onError = vi.fn();

    expect(
      await retryUntilDone(async () => undefined, new Stoppable(), onError),
    ).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('retries after a failure, reports each, and pauses longer each time', async () => {
    const control = new Stoppable();
    const sleep = vi.spyOn(control, 'sleep').mockResolvedValue();
    let calls = 0;
    const onError = vi.fn();

    const done = await retryUntilDone(
      async () => {
        if (++calls < 4) throw new Error(`fail ${calls}`);
      },
      control,
      onError,
    );

    expect(done).toBe(true);
    expect(onError.mock.calls.map(([, attempt]) => attempt)).toEqual([1, 2, 3]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('caps the pause', async () => {
    const control = new Stoppable();
    const sleep = vi.spyOn(control, 'sleep').mockResolvedValue();
    let calls = 0;

    await retryUntilDone(
      async () => {
        if (++calls < 6) throw new Error('x');
      },
      control,
      () => undefined,
      3000,
    );

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      1000, 2000, 3000, 3000, 3000,
    ]);
  });

  it('gives up with false when stopped before it succeeded', async () => {
    const control = new Stoppable();
    const work = vi.fn(async () => {
      control.stop();
      throw new Error('x');
    });

    expect(await retryUntilDone(work, control, () => undefined)).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('does not even start when already stopped', async () => {
    const control = new Stoppable();
    control.stop();
    const work = vi.fn(async () => undefined);

    expect(await retryUntilDone(work, control, () => undefined)).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it('with atLeastOnce, tries once even when already stopped, and does not retry', async () => {
    const control = new Stoppable();
    control.stop();
    const ok = vi.fn(async () => undefined);
    const failing = vi.fn(async () => {
      throw new Error('x');
    });

    expect(await retryUntilDone(ok, control, () => undefined, 1000, true)).toBe(
      true,
    );
    expect(
      await retryUntilDone(failing, control, () => undefined, 1000, true),
    ).toBe(false);
    expect(ok).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledOnce();
  });
});
