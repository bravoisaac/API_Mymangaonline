import { Router } from 'express';

import { env } from '../config/env';
import { proxyImage } from '../controllers/proxy.controller';
import { createRateLimit } from '../middleware/rateLimit.middleware';

export const proxyRoutes = Router();

proxyRoutes.get(
  '/image',
  createRateLimit({
    windowMs: env.rateLimitWindowMs,
    maxRequests: env.imageProxyRateLimitMaxRequests,
    maxKeys: env.rateLimitMaxKeys
  }),
  proxyImage
);
