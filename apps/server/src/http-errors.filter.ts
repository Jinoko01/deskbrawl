import type { ErrorCode } from '@deskbrawl/protocol';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { failure } from './errors';

@Catch()
export class HttpErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const parserType =
      typeof error === 'object' && error !== null && 'type' in error
        ? error.type
        : undefined;
    if (
      parserType === 'entity.parse.failed' ||
      parserType === 'entity.too.large'
    ) {
      response
        .status(parserType === 'entity.too.large' ? 413 : 400)
        .json({ ok: false, code: 'INVALID_INPUT' });
      return;
    }
    const body = failure(error);
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : this.statusFor(body.code);
    response.status(status).json(body);
  }

  private statusFor(code: ErrorCode): number {
    switch (code) {
      case 'UNAUTHORIZED':
        return 401;
      case 'INTERNAL_ERROR':
        return 500;
      case 'RATE_LIMITED':
        return 429;
      default:
        return 400;
    }
  }
}
