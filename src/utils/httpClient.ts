import http from 'node:http';
import https from 'node:https';

import axios from 'axios';

import { env } from '../config/env';

export const httpClient = axios.create({
  timeout: env.requestTimeoutMs,
  httpAgent: new http.Agent({
    keepAlive: true,
    maxSockets: 20
  }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 20
  }),
  headers: {
    Accept: 'application/json',
    'User-Agent': 'API_Mymangaonline/1.0.0'
  }
});
