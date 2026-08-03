import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../utils/errors';

export function errorMiddleware(error: Error, request: Request, response: Response, _next: NextFunction) {
  const parsingError = error as Error & { type?: string };
  const isPayloadTooLarge = parsingError.type === 'entity.too.large';
  const isInvalidJson = parsingError.type === 'entity.parse.failed';
  const statusCode = isPayloadTooLarge
    ? 413
    : isInvalidJson
      ? 400
      : error instanceof AppError
        ? error.statusCode
        : 500;
  const message = isPayloadTooLarge
    ? 'Request body is too large'
    : isInvalidJson
      ? 'Request body contains invalid JSON'
      : error instanceof AppError
        ? error.message
        : 'Internal server error';

  if (statusCode >= 500) {
    console.error('[API error]', {
      method: request.method,
      path: request.path,
      statusCode,
      name: error.name,
      message: error.message
    });
  }

  response.status(statusCode).json({
    error: {
      message,
      ...(env.includeErrorStacks && env.nodeEnv !== 'production' ? { stack: error.stack } : {})
    }
  });
}
