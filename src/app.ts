import cors from 'cors';
import express from 'express';

import { env } from './config/env';
import { errorMiddleware } from './middleware/error.middleware';
import { notFoundMiddleware } from './middleware/notFound.middleware';
import { createRateLimit } from './middleware/rateLimit.middleware';
import { securityHeadersMiddleware } from './middleware/securityHeaders.middleware';
import { indexRoutes } from './routes/index.routes';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.trustProxy);

app.use(securityHeadersMiddleware);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins === '*' || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Content-Type'],
    maxAge: 86400
  })
);
app.use(
  createRateLimit({
    windowMs: env.rateLimitWindowMs,
    maxRequests: env.rateLimitMaxRequests,
    maxKeys: env.rateLimitMaxKeys,
    skip: (request) => request.method === 'OPTIONS' || request.path === '/api/health'
  })
);
app.use(express.json({ limit: '32kb', strict: true }));

app.use('/api', indexRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);
