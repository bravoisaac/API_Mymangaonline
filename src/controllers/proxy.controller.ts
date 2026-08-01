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
  new URL(env.comickImageBaseUrl).hostname.toLowerCase()
];
const ALLOWED_IMAGE_HOST_SET = new Set(ALLOWED_IMAGE_HOSTS);
const SAFE_IMAGE_AGENT = createSafeHttpsAgent({ allowedHosts: ALLOWED_IMAGE_HOST_SET });
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function getImageUrl(value: unknown) {
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

export async function proxyImage(request: Request, response: Response, next: NextFunction) {
  try {
    const imageUrl = getImageUrl(request.query.url);
    const safeImageUrl = await assertSafeOutboundUrl(imageUrl, { allowedHosts: ALLOWED_IMAGE_HOST_SET });
    const upstream = await httpClient.get<ArrayBuffer>(safeImageUrl.toString(), {
      responseType: 'arraybuffer',
      headers: getImageProxyHeaders(),
      httpsAgent: SAFE_IMAGE_AGENT,
      maxRedirects: 0,
      maxContentLength: env.imageProxyMaxBytes,
      maxBodyLength: env.imageProxyMaxBytes
    });
    const imageBuffer = Buffer.from(upstream.data);
    const contentType = getHeaderString(upstream.headers['content-type']).split(';')[0].trim().toLowerCase();

    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new ExternalApiError('Comick image response had an unsupported content type');
    }

    if (imageBuffer.length > env.imageProxyMaxBytes) {
      throw new ExternalApiError('Comick image response exceeded the configured size limit');
    }

    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(imageBuffer.length));
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(imageBuffer);
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      next(new ExternalApiError(status ? `Comick image request failed with status ${status}` : 'Comick image request failed'));
      return;
    }

    next(error);
  }
}
