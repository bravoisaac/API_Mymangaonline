import axios from 'axios';

import { env } from '../config/env';

export const httpClient = axios.create({
  timeout: env.requestTimeoutMs,
  headers: {
    Accept: 'application/json',
    'User-Agent': 'API_Mymangaonline/1.0.0'
  }
});
