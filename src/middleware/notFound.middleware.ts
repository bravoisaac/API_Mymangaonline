import { Request, Response } from 'express';

export function notFoundMiddleware(request: Request, response: Response) {
  response.status(404).json({
    error: {
      message: `Route ${request.method} ${request.originalUrl} was not found`
    }
  });
}
