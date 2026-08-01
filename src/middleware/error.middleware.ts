import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../utils/errors';

export function errorMiddleware(error: Error, request: Request, response: Response, _next: NextFunction) {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError ? error.message : 'Internal server error';

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
