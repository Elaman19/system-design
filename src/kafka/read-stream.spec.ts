import type { PinoLogger } from 'nestjs-pino';
import { Stoppable } from '../common/retry.js';
import { readStream } from './read-stream.js';

const logger = () =>
  ({ error: vi.fn() }) as unknown as PinoLogger & {
    error: ReturnType<typeof vi.fn>;
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
      logger(),
      'x',
    );

    expect(seen).toEqual([1, 2, 3]);
  });

  it('logs a failing stream and returns', async () => {
    const log = logger();

    await readStream(
      failing(),
      async () => undefined,
      new Stoppable(),
      log,
      'reader failed',
    );

    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'reader failed',
    );
  });

  it('is silent about a stream that fails during shutdown', async () => {
    const log = logger();
    const control = new Stoppable();
    control.stop();

    await readStream(
      failing(),
      async () => undefined,
      control,
      log,
      'reader failed',
    );

    expect(log.error).not.toHaveBeenCalled();
  });
});
