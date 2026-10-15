import type { EntityManager } from 'typeorm';
import { TxHooks } from './tx-hooks.js';

describe('TxHooks', () => {
  it('does nothing in production: tests are the only ones that override it', () => {
    expect(
      new TxHooks().at('purchase:afterRead', {} as EntityManager),
    ).toBeUndefined();
  });
});
