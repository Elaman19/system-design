import { HttpException, type HttpStatus } from '@nestjs/common';

/** Error body shared by every non-2xx answer: a stable machine `code` plus a human `message`. */
export function apiError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}
