import { AxiosError } from 'axios';
import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { assertSafeOutboundUrl, createSafeHttpsAgent, validateOutboundUrlSyntax } from '../security/outboundUrl';
import { ExternalApiError } from '../utils/errors';
import { httpClient } from '../utils/httpClient';
import { getRequiredString } from '../utils/requestValidation';

const ALLOWED_IMAGE_HOSTS = [
  'meo.comick.pictures',
  'meo2.comick.pictures',
  'meo3.comick.pictures',
  'comicknew.pictures',
  'cdn1.comicknew.pictures',
  'cdn2.comicknew.pictures',
  new URL(env.comickImageBaseUrl).hostname.toLowerCase()
];
const ALLOWED_IMAGE_HOST_SET = new Set(ALLOWED_IMAGE_HOSTS);
const SAFE_IMAGE_AGENT = createSafeHttpsAgent({ allowedHosts: ALLOWED_IMAGE_HOST_SET });
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const IMAGE_PROXY_CONCURRENCY = 1;
const IMAGE_PROXY_REQUEST_DELAY_MS = 200;
const IMAGE_PROXY_RETRY_ATTEMPTS = 4;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_CACHE_MAX_ITEM_BYTES = 2 * 1024 * 1024;

type ProxiedImage = {
  buffer: Buffer;
  contentType: string;
};

type CachedImage = ProxiedImage & {
  expiresAt: number;
};

const imageCache = new Map<string, CachedImage>();
const pendingImageRequests = new Map<string, Promise<ProxiedImage>>();
const imageRequestWaiters: Array<() => void> = [];
let activeImageRequests = 0;
let imageCacheBytes = 0;

export function getImageUrl(value: unknown) {
  const rawUrl = getRequiredString(value, 'url', { maxLength: 4096 });
  return validateOutboundUrlSyntax(rawUrl, ALLOWED_IMAGE_HOST_SET).toString();
}

function getHeaderString(value: unknown, fallback = '') {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return fallback;
}

function getImageProxyHeaders() {
  return {
    Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
    Referer: `${env.comickBaseUrl}/`,
    Origin: env.comickBaseUrl,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireImageRequestSlot() {
  if (activeImageRequests < IMAGE_PROXY_CONCURRENCY) {
    activeImageRequests += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    imageRequestWaiters.push(() => {
      activeImageRequests += 1;
      resolve();
    });
  });
}

function releaseImageRequestSlot() {
  activeImageRequests = Math.max(0, activeImageRequests - 1);
  imageRequestWaiters.shift()?.();
}

async function withImageRequestSlot<TValue>(loader: () => Promise<TValue>) {
  await acquireImageRequestSlot();

  try {
    return await loader();
  } finally {
    await wait(IMAGE_PROXY_REQUEST_DELAY_MS);
    releaseImageRequestSlot();
  }
}

function getRetryDelayMs(error: AxiosError, attempt: number) {
  const retryAfter = getHeaderString(error.response?.headers['retry-after']);
  const retryAfterSeconds = Number(retryAfter);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(Math.max(retryAfterSeconds * 1000, 250), 5000);
  }

  const retryAt = Date.parse(retryAfter);

  if (Number.isFinite(retryAt)) {
    return Math.min(Math.max(retryAt - Date.now(), 250), 5000);
  }

  return 400 * 2 ** attempt;
}

function getCachedImage(imageUrl: string) {
  const cached = imageCache.get(imageUrl);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    imageCache.delete(imageUrl);
    imageCacheBytes -= cached.buffer.length;
    return undefined;
  }

  imageCache.delete(imageUrl);
  imageCache.set(imageUrl, cached);
  return cached;
}

function cacheImage(imageUrl: string, image: ProxiedImage) {
  if (image.buffer.length > IMAGE_CACHE_MAX_ITEM_BYTES) {
    return;
  }

  const previous = imageCache.get(imageUrl);

  if (previous) {
    imageCache.delete(imageUrl);
    imageCacheBytes -= previous.buffer.length;
  }

  for (const [cachedUrl, cached] of imageCache) {
    if (cached.expiresAt <= Date.now()) {
      imageCache.delete(cachedUrl);
      imageCacheBytes -= cached.buffer.length;
    }
  }

  while (imageCache.size > 0 && imageCacheBytes + image.buffer.length > IMAGE_CACHE_MAX_BYTES) {
    const oldestEntry = imageCache.entries().next().value as [string, CachedImage] | undefined;

    if (!oldestEntry) {
      break;
    }

    imageCache.delete(oldestEntry[0]);
    imageCacheBytes -= oldestEntry[1].buffer.length;
  }

  imageCache.set(imageUrl, {
    ...image,
    expiresAt: Date.now() + IMAGE_CACHE_TTL_MS
  });
  imageCacheBytes += image.buffer.length;
}

async function downloadImage(imageUrl: URL): Promise<ProxiedImage> {
  for (let attempt = 0; attempt < IMAGE_PROXY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const upstream = await withImageRequestSlot(() =>
        httpClient.get<ArrayBuffer>(imageUrl.toString(), {
          responseType: 'arraybuffer',
          headers: getImageProxyHeaders(),
          httpsAgent: SAFE_IMAGE_AGENT,
          maxRedirects: 0,
          maxContentLength: env.imageProxyMaxBytes,
          maxBodyLength: env.imageProxyMaxBytes
        })
      );
      const imageBuffer = Buffer.from(upstream.data);
      const contentType = getHeaderString(upstream.headers['content-type']).split(';')[0].trim().toLowerCase();

      if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
        throw new ExternalApiError('Comick image response had an unsupported content type');
      }

      if (imageBuffer.length > env.imageProxyMaxBytes) {
        throw new ExternalApiError('Comick image response exceeded the configured size limit');
      }

      return { buffer: imageBuffer, contentType };
    } catch (error) {
      if (!(error instanceof AxiosError) || error.response?.status !== 429 || attempt >= IMAGE_PROXY_RETRY_ATTEMPTS - 1) {
        throw error;
      }

      await wait(getRetryDelayMs(error, attempt));
    }
  }

  throw new ExternalApiError('Comick image request failed');
}

function loadImage(imageUrl: URL) {
  const cacheKey = imageUrl.toString();
  const cached = getCachedImage(cacheKey);

  if (cached) {
    return Promise.resolve<ProxiedImage>(cached);
  }

  const pending = pendingImageRequests.get(cacheKey);

  if (pending) {
    return pending;
  }

  const request = downloadImage(imageUrl)
    .then((image) => {
      cacheImage(cacheKey, image);
      return image;
    })
    .finally(() => {
      pendingImageRequests.delete(cacheKey);
    });

  pendingImageRequests.set(cacheKey, request);
  return request;
}

export async function proxyImage(request: Request, response: Response, next: NextFunction) {
  try {
    const imageUrl = getImageUrl(request.query.url);
    const safeImageUrl = await assertSafeOutboundUrl(imageUrl, { allowedHosts: ALLOWED_IMAGE_HOST_SET });
    const image = await loadImage(safeImageUrl);

    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', String(image.buffer.length));
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(image.buffer);
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      next(new ExternalApiError(status ? `Comick image request failed with status ${status}` : 'Comick image request failed'));
      return;
    }

    next(error);
  }
}
