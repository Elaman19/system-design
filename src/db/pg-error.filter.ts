import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { apiError } from '../common/api-error.js';
import {
  CONSTRAINT_MESSAGES,
  FALLBACK_CHECK_MESSAGE,
  FALLBACK_UNIQUE_MESSAGE,
} from './constraint-messages.js';

interface PgError {
  code?: string;
  constraint?: string;
}

/**
 * Turns database-enforced rule violations into client errors instead of 500s.
 * Anything else falls through to Nest's default handler (500, logged).
 */
@Catch(QueryFailedError)
export class PgErrorFilter extends BaseExceptionFilter {
  override catch(exception: QueryFailedError, host: ArgumentsHost) {
    const { code, constraint } = exception.driverError as PgError;
    const named = constraint ? CONSTRAINT_MESSAGES[constraint] : undefined;
    switch (code) {
      case '23505': // unique_violation
        return super.catch(
          apiError(
            HttpStatus.CONFLICT,
            'ALREADY_EXISTS',
            named ?? FALLBACK_UNIQUE_MESSAGE,
          ),
          host,
        );
      case '23514': // check_violation
        return super.catch(
          apiError(
            HttpStatus.CONFLICT,
            'RULE_VIOLATED',
            named ?? FALLBACK_CHECK_MESSAGE,
          ),
          host,
        );
      case '23503': // foreign_key_violation
        return super.catch(
          apiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'REFERENCE_NOT_FOUND',
            'Связанная запись не найдена',
          ),
          host,
        );
      case '40P01': // deadlock_detected
      case '40001': // serialization_failure
        return super.catch(
          apiError(
            HttpStatus.CONFLICT,
            'RETRY',
            'Конфликт одновременных операций, повторите запрос',
          ),
          host,
        );
      default:
        return super.catch(exception, host);
    }
  }
}
