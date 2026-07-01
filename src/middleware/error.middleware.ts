import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../utils/errors';

export function errorMiddleware(error: Error, _request: Request, response: Response, _next: NextFunction) {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError ? error.message : 'Internal server error';

  response.status(statusCode).json({
    error: {
      message,
      ...(env.nodeEnv === 'development' ? { stack: error.stack } : {})
    }
  });
}
