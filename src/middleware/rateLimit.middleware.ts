import { NextFunction, Request, Response } from 'express';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  maxKeys: number;
  skip?: (request: Request) => boolean;
};

export function createRateLimit(options: RateLimitOptions) {
  const entries = new Map<string, RateLimitEntry>();
  let lastPruneAt = 0;

  function pruneExpiredEntries(now: number) {
    if (now - lastPruneAt < options.windowMs && entries.size < options.maxKeys) {
      return;
    }

    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) {
        entries.delete(key);
      }
    }

    lastPruneAt = now;
  }

  return function rateLimitMiddleware(request: Request, response: Response, next: NextFunction) {
    if (options.skip?.(request)) {
      next();
      return;
    }

    const now = Date.now();
    pruneExpiredEntries(now);
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let entry = entries.get(key);

    if (!entry || entry.resetAt <= now) {
      if (entries.size >= options.maxKeys) {
        const oldestKey = entries.keys().next().value;

        if (typeof oldestKey === 'string') {
          entries.delete(oldestKey);
        }
      }

      entry = {
        count: 0,
        resetAt: now + options.windowMs
      };
      entries.set(key, entry);
    }

    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    const remaining = Math.max(0, options.maxRequests - entry.count - 1);

    response.setHeader('RateLimit-Limit', String(options.maxRequests));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(resetSeconds));

    if (entry.count >= options.maxRequests) {
      response.setHeader('Retry-After', String(resetSeconds));
      response.setHeader('Cache-Control', 'no-store');
      response.status(429).json({
        error: {
          message: 'Too many requests. Please try again later.'
        }
      });
      return;
    }

    entry.count += 1;
    next();
  };
}
