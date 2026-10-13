import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { apiError } from './api-error.js';

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `Некорректные данные: ${details}`,
      );
    }
    return result.data;
  }
}
