import { EventEmitter } from 'node:events';
import { connectionCloseOnShutdown } from './connection-close.middleware.js';

function setup(shuttingDown: boolean) {
  const headers: Record<string, string> = {};
  const writeHead = vi.fn(function (this: unknown, ..._args: unknown[]) {
    return this;
  });
  const res = Object.assign(new EventEmitter(), {
    writeHead,
    setHeader: (k: string, v: string) => void (headers[k] = v),
  });
  const next = vi.fn();
  connectionCloseOnShutdown(() => shuttingDown)({} as any, res as any, next);
  return { res, headers, writeHead, next };
}

describe('connectionCloseOnShutdown', () => {
  it('adds Connection: close when the head is written during shutdown', () => {
    const { res, headers, writeHead, next } = setup(true);
    expect(next).toHaveBeenCalledOnce();

    res.writeHead(200, { 'x-a': 'b' } as any);

    expect(headers.Connection).toBe('close');
    expect(writeHead).toHaveBeenCalledWith(200, { 'x-a': 'b' });
  });

  it('leaves keep-alive alone otherwise', () => {
    const { res, headers, writeHead } = setup(false);

    res.writeHead(200);

    expect(headers).toEqual({});
    expect(writeHead).toHaveBeenCalledWith(200);
  });
});
