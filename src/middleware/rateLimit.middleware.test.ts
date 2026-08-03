import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';

import { createRateLimit } from './rateLimit.middleware';

test('returns 429 and Retry-After after the configured request budget', () => {
  const limiter = createRateLimit({ windowMs: 60_000, maxRequests: 2, maxKeys: 100 });
  const headers = new Map<string, string>();
  let statusCode = 200;
  let payload: unknown;
  let nextCalls = 0;
  const request = {
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' }
  } as Request;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(value: number) {
      statusCode = value;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    }
  } as unknown as Response;
  const next = (() => {
    nextCalls += 1;
  }) as NextFunction;

  limiter(request, response, next);
  limiter(request, response, next);
  limiter(request, response, next);

  assert.equal(nextCalls, 2);
  assert.equal(statusCode, 429);
  assert.ok(Number(headers.get('retry-after')) >= 1);
  assert.deepEqual(payload, {
    error: {
      message: 'Too many requests. Please try again later.'
    }
  });
});
