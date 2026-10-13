import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { PgErrorFilter } from './pg-error.filter.js';

describe('PgErrorFilter', () => {
  const host = {} as ArgumentsHost;
  let delegate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delegate = vi
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockReturnValue();
  });
  afterEach(() => delegate.mockRestore());

  const failure = (code: string, constraint?: string) =>
    new QueryFailedError(
      'q',
      [],
      Object.assign(new Error('pg'), { code, constraint }),
    );

  function mapped(error: QueryFailedError) {
    new PgErrorFilter().catch(error, host);
    const [passed] = delegate.mock.lastCall!;
    return passed instanceof HttpException
      ? { status: passed.getStatus(), body: passed.getResponse() }
      : passed;
  }

  it('unique violation -> 409 with the message of the named constraint', () => {
    expect(mapped(failure('23505', 'wallets_company_id_key'))).toEqual({
      status: 409,
      body: {
        statusCode: 409,
        code: 'ALREADY_EXISTS',
        message: 'У компании уже есть кошелёк',
      },
    });
  });

  it('unique violation on an unknown or missing constraint -> generic 409', () => {
    for (const constraint of ['something_else', undefined]) {
      expect(mapped(failure('23505', constraint))).toMatchObject({
        status: 409,
        body: { message: 'Такая запись уже существует' },
      });
    }
  });

  it('check violation -> 409, named or generic', () => {
    expect(
      mapped(failure('23514', 'wallets_balance_non_negative')),
    ).toMatchObject({
      status: 409,
      body: {
        code: 'RULE_VIOLATED',
        message: 'Недостаточно средств на кошельке',
      },
    });
    expect(mapped(failure('23514'))).toMatchObject({
      body: { message: 'Данные нарушают правила площадки' },
    });
  });

  it('foreign key violation -> 422', () => {
    expect(mapped(failure('23503', 'deals_lot_seller_fkey'))).toMatchObject({
      status: 422,
      body: { code: 'REFERENCE_NOT_FOUND' },
    });
  });

  it('deadlock and serialization failure -> 409 RETRY', () => {
    for (const code of ['40P01', '40001']) {
      expect(mapped(failure(code))).toMatchObject({
        status: 409,
        body: { code: 'RETRY' },
      });
    }
  });

  it('anything else is passed on untouched (500)', () => {
    const error = failure('XX000');
    expect(mapped(error)).toBe(error);
  });
});
