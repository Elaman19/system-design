import type { ProcessFailure } from '../common/process-failure.js';
import { Stoppable } from '../common/retry.js';
import { readStream } from './read-stream.js';

const failure = () =>
  ({ fatal: vi.fn() }) as unknown as ProcessFailure & {
    fatal: ReturnType<typeof vi.fn>;
  };

async function* failing() {
  yield 1;
  throw new Error('stream broke');
}

describe('readStream', () => {
  it('hands every message to the handler, one at a time and in order', async () => {
    const seen: number[] = [];

    await readStream(
      (async function* () {
        yield* [1, 2, 3];
      })(),
      async (m) => {
        await new Promise((r) => setTimeout(r, 5 - m));
        seen.push(m);
      },
      new Stoppable(),
      failure(),
      'x',
    );

    expect(seen).toEqual([1, 2, 3]);
  });

  it('reports a failing stream as fatal: nothing is read any more, the process has to restart', async () => {
    const fail = failure();

    await readStream(
      failing(),
      async () => undefined,
      new Stoppable(),
      fail,
      'reader failed',
    );

    expect(fail.fatal).toHaveBeenCalledWith(expect.any(Error), 'reader failed');
  });

  it('is silent about a stream that fails during shutdown', async () => {
    const fail = failure();
    const control = new Stoppable();
    control.stop();

    await readStream(
      failing(),
      async () => undefined,
      control,
      fail,
      'reader failed',
    );

    expect(fail.fatal).not.toHaveBeenCalled();
  });
});
