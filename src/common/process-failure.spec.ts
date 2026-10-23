import type { PinoLogger } from 'nestjs-pino';
import { ProcessFailure } from './process-failure.js';

const logger = () =>
  ({ setContext: vi.fn(), fatal: vi.fn() }) as unknown as PinoLogger & {
    fatal: ReturnType<typeof vi.fn>;
  };

describe('ProcessFailure', () => {
  it('logs the failure and calls the handler the entry point set', () => {
    const log = logger();
    const failure = new ProcessFailure(log);
    const handler = vi.fn();
    failure.onFatal(handler);
    const error = new Error('stream broke');

    failure.fatal(error, 'reader failed');

    expect(log.fatal).toHaveBeenCalledWith({ err: error }, 'reader failed');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('without a handler (tests, the API) only logs', () => {
    const log = logger();

    new ProcessFailure(log).fatal(new Error('x'), 'reader failed');

    expect(log.fatal).toHaveBeenCalledOnce();
  });
});
