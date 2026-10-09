import type { Logger } from 'pino';
import { nestLogger } from './nest-logger.js';

function setup() {
  const pino = {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
  return { pino, logger: nestLogger(pino as unknown as Logger) };
}

describe('nestLogger', () => {
  it('maps Nest levels to pino levels and takes the context', () => {
    const { pino, logger } = setup();

    logger.log('a', 'Ctx');
    logger.warn('b', 'Ctx');
    logger.debug?.('c', 'Ctx');
    logger.verbose?.('d', 'Ctx');
    logger.fatal?.('e', 'Ctx');

    expect(pino.info).toHaveBeenCalledWith({ context: 'Ctx' }, 'a');
    expect(pino.warn).toHaveBeenCalledWith({ context: 'Ctx' }, 'b');
    expect(pino.debug).toHaveBeenCalledWith({ context: 'Ctx' }, 'c');
    expect(pino.trace).toHaveBeenCalledWith({ context: 'Ctx' }, 'd');
    expect(pino.fatal).toHaveBeenCalledWith({ context: 'Ctx' }, 'e');
  });

  it('keeps the stack Nest passes before the context on errors', () => {
    const { pino, logger } = setup();

    logger.error('boom', 'stack text', 'TypeOrmModule');

    expect(pino.error).toHaveBeenCalledWith(
      { context: 'TypeOrmModule', stack: 'stack text' },
      'boom',
    );
  });

  it('logs Error objects as err and objects as JSON', () => {
    const { pino, logger } = setup();
    const err = new Error('bad');

    logger.error(err);
    logger.log({ a: 1 });

    expect(pino.error).toHaveBeenCalledWith({ context: undefined, err }, 'bad');
    expect(pino.info).toHaveBeenCalledWith({ context: undefined }, '{"a":1}');
  });
});
