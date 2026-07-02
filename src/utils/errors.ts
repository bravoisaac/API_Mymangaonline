export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SourceNotFoundError extends AppError {
  constructor(source: string) {
    super(`Source "${source}" was not found`, 404);
  }
}

export class SourceNotImplementedError extends AppError {
  constructor(message = 'Source not implemented yet') {
    super(message, 501);
  }
}

export class ExternalApiError extends AppError {
  constructor(message = 'External API request failed') {
    super(message, 502);
  }
}

export class SourceUnavailableError extends AppError {
  constructor(source: string, reason: string) {
    super(`Source "${source}" is unavailable: ${reason}`, 503);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}
