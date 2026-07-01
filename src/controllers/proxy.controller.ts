import { Readable } from 'node:stream';

import { AxiosError } from 'axios';
import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { ExternalApiError, ValidationError } from '../utils/errors';
import { httpClient } from '../utils/httpClient';

const ALLOWED_IMAGE_HOSTS = [
  'meo.comick.pictures',
  'meo2.comick.pictures',
  'meo3.comick.pictures'
];

function isAllowedComickImageHost(hostname: string) {
  return hostname === 'comicknew.pictures' || hostname.endsWith('.comicknew.pictures') || ALLOWED_IMAGE_HOSTS.includes(hostname);
}

function getImageUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError('url is required');
  }

  const parsedUrl = new URL(value);

  if (parsedUrl.protocol !== 'https:') {
    throw new ValidationError('Only https image URLs are allowed');
  }

  if (!isAllowedComickImageHost(parsedUrl.hostname)) {
    throw new ValidationError('Image host is not allowed');
  }

  return parsedUrl.toString();
}

function getHeaderString(value: unknown, fallback = '') {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return fallback;
}

function getImageProxyHeaders() {
  return {
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    Referer: `${env.comickBaseUrl}/`,
    Origin: env.comickBaseUrl,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  };
}

export async function proxyImage(request: Request, response: Response, next: NextFunction) {
  try {
    const imageUrl = getImageUrl(request.query.url);
    const upstream = await httpClient.get(imageUrl, {
      responseType: 'stream',
      headers: getImageProxyHeaders()
    });
    const stream = upstream.data as Readable;
    const contentLength = getHeaderString(upstream.headers['content-length']);

    response.setHeader('Content-Type', getHeaderString(upstream.headers['content-type'], 'image/webp'));
    if (contentLength) {
      response.setHeader('Content-Length', contentLength);
    }
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.setHeader('Access-Control-Allow-Origin', '*');

    stream.on('error', next);
    stream.pipe(response);
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      next(new ExternalApiError(status ? `Comick image request failed with status ${status}` : 'Comick image request failed'));
      return;
    }

    next(error);
  }
}
