import { AxiosError } from 'axios';
import { NextFunction, Request, Response } from 'express';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { env } from '../config/env';
import { createSafeHttpsAgent, validateOutboundUrlSyntax } from '../security/outboundUrl';
import { AppError, ExternalApiError } from '../utils/errors';
import { httpClient } from '../utils/httpClient';
import { getRequiredString } from '../utils/requestValidation';

const ALLOWED_IMAGE_HOSTS = [
  'meo.comick.pictures',
  'meo2.comick.pictures',
  'meo3.comick.pictures',
  'comicknew.pictures',
  'cdn1.comicknew.pictures',
  'cdn2.comicknew.pictures',
  'uploads.mangadex.org',
  new URL(env.comickImageBaseUrl).hostname.toLowerCase()
];
const ALLOWED_IMAGE_HOST_SET = new Set(ALLOWED_IMAGE_HOSTS);
const SAFE_IMAGE_AGENT = createSafeHttpsAgent({ allowedHosts: ALLOWED_IMAGE_HOST_SET });
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const IMAGE_PROXY_RETRY_ATTEMPTS = 4;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_CACHE_MAX_ITEM_BYTES = 5 * 1024 * 1024;
const IMAGE_BROWSER_CACHE_SECONDS = 7 * 24 * 60 * 60;
const IMAGE_SHARED_CACHE_SECONDS = 30 * 24 * 60 * 60;

type ProxiedImage = {
  buffer: Buffer;
  contentType: string;
};

type CachedImage = ProxiedImage & {
  expiresAt: number;
};

type UpstreamImage = {
  contentLength?: number;
  contentType: string;
  stream: Readable;
};

type PendingImageRequest = {
  promise: Promise<ProxiedImage>;
  reject: (error: unknown) => void;
  resolve: (image: ProxiedImage) => void;
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

function getImageProxyHeaders(imageUrl: URL) {
  const isMangaDexImage = imageUrl.hostname.toLowerCase() === 'uploads.mangadex.org';
  const sourceOrigin = isMangaDexImage ? 'https://mangadex.org' : env.comickBaseUrl;

  return {
    Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
    Referer: `${sourceOrigin.replace(/\/$/, '')}/`,
    Origin: sourceOrigin.replace(/\/$/, ''),
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function createPendingImageRequest(): PendingImageRequest {
  let resolve!: (image: ProxiedImage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ProxiedImage>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  // The first request owns the stream, so keep a rejected download from becoming
  // an unhandled promise when no coalesced request is waiting for it.
  void promise.catch(() => undefined);
  return { promise, reject, resolve };
}

async function acquireImageRequestSlot() {
  if (activeImageRequests < env.imageProxyConcurrency) {
    activeImageRequests += 1;
    return;
  }

  if (imageRequestWaiters.length >= env.imageProxyMaxQueue) {
    throw new AppError('Image proxy is busy. Please try again later.', 503);
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

function releaseImageStreamSlot(stream: Readable) {
  let released = false;

  const release = () => {
    if (released) {
      return;
    }

    released = true;
    setTimeout(releaseImageRequestSlot, env.imageProxyRequestDelayMs);
  };

  stream.once('end', release);
  stream.once('error', release);
  stream.once('close', release);
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

async function openImageStream(imageUrl: URL): Promise<UpstreamImage> {
  for (let attempt = 0; attempt < IMAGE_PROXY_RETRY_ATTEMPTS; attempt += 1) {
    let slotAcquired = false;
    let slotManagedByStream = false;

    try {
      await acquireImageRequestSlot();
      slotAcquired = true;

      const upstream = await httpClient.get<Readable>(imageUrl.toString(), {
        responseType: 'stream',
        headers: getImageProxyHeaders(imageUrl),
        httpsAgent: SAFE_IMAGE_AGENT,
        maxRedirects: 0,
        maxContentLength: env.imageProxyMaxBytes,
        maxBodyLength: env.imageProxyMaxBytes
      });
      releaseImageStreamSlot(upstream.data);
      slotManagedByStream = true;

      const contentType = getHeaderString(upstream.headers['content-type']).split(';')[0].trim().toLowerCase();
      const contentLengthHeader = getHeaderString(upstream.headers['content-length']);
      const rawContentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
      const contentLength = Number.isSafeInteger(rawContentLength) && rawContentLength >= 0
        ? rawContentLength
        : undefined;

      if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
        upstream.data.destroy();
        throw new ExternalApiError('Image provider returned an unsupported content type');
      }

      if (contentLength !== undefined && contentLength > env.imageProxyMaxBytes) {
        upstream.data.destroy();
        throw new ExternalApiError('Image provider response exceeded the configured size limit');
      }

      return { contentLength, contentType, stream: upstream.data };
    } catch (error) {
      if (slotAcquired && !slotManagedByStream) {
        const errorStream = error instanceof AxiosError ? error.response?.data : undefined;

        if (errorStream instanceof Readable) {
          errorStream.destroy();
        }

        await wait(env.imageProxyRequestDelayMs);
        releaseImageRequestSlot();
      }

      if (!(error instanceof AxiosError) || error.response?.status !== 429 || attempt >= IMAGE_PROXY_RETRY_ATTEMPTS - 1) {
        throw error;
      }

      await wait(getRetryDelayMs(error, attempt));
    }
  }

  throw new ExternalApiError('Image provider request failed');
}

async function streamAndCacheImage(
  imageUrl: URL,
  response: Response,
  pending: PendingImageRequest
) {
  const cacheKey = imageUrl.toString();
  try {
    const upstream = await openImageStream(imageUrl);
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const collector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;

        if (receivedBytes > env.imageProxyMaxBytes) {
          callback(new ExternalApiError('Image provider response exceeded the configured size limit'));
          return;
        }

        chunks.push(chunk);
        callback(null, chunk);
      }
    });

    response.setHeader('Content-Type', upstream.contentType);

    if (upstream.contentLength !== undefined) {
      response.setHeader('Content-Length', String(upstream.contentLength));
    }

    setImageCacheHeaders(response);

    await pipeline(upstream.stream, collector, response);
    const image = { buffer: Buffer.concat(chunks, receivedBytes), contentType: upstream.contentType };
    cacheImage(cacheKey, image);
    pending.resolve(image);
  } catch (error) {
    pending.reject(error);
    throw error;
  } finally {
    pendingImageRequests.delete(cacheKey);
  }
}

function setImageCacheHeaders(response: Response) {
  response.setHeader(
    'Cache-Control',
    `public, max-age=${IMAGE_BROWSER_CACHE_SECONDS}, s-maxage=${IMAGE_SHARED_CACHE_SECONDS}, stale-while-revalidate=86400`
  );
}

function loadBufferedImage(imageUrl: URL) {
  const cacheKey = imageUrl.toString();
  const cached = getCachedImage(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = pendingImageRequests.get(cacheKey);

  if (pending) {
    return pending;
  }

  return undefined;
}

export async function proxyImage(request: Request, response: Response, next: NextFunction) {
  try {
    const parsedImageUrl = new URL(getImageUrl(request.query.url));
    const bufferedImage = loadBufferedImage(parsedImageUrl);

    if (!bufferedImage) {
      const pending = createPendingImageRequest();
      pendingImageRequests.set(parsedImageUrl.toString(), pending.promise);
      await streamAndCacheImage(parsedImageUrl, response, pending);
      return;
    }

    const image = await bufferedImage;

    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', String(image.buffer.length));
    setImageCacheHeaders(response);
    response.send(image.buffer);
  } catch (error) {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      next(new ExternalApiError(status ? `Image provider request failed with status ${status}` : 'Image provider request failed'));
      return;
    }

    if (error instanceof AppError && error.statusCode === 503) {
      response.setHeader('Retry-After', '1');
    }

    next(error);
  }
}
