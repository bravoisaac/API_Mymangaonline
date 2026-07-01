import cors from 'cors';
import express from 'express';

import { env } from './config/env';
import { errorMiddleware } from './middleware/error.middleware';
import { notFoundMiddleware } from './middleware/notFound.middleware';
import { indexRoutes } from './routes/index.routes';

export const app = express();

app.use(
  cors({
    origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((origin) => origin.trim())
  })
);
app.use(express.json());

app.use('/api', indexRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);
