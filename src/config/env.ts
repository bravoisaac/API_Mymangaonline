import dotenv from 'dotenv';

import { ChapterQuality } from '../types/manga.types';

dotenv.config();

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

function parseNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerInRange(name: string, value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function parseCsv(value: string | undefined, fallback: string[]) {
  const values = (value ?? fallback.join(','))
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(values));
}

function parseCorsOrigins(value: string | undefined, nodeEnv: string): '*' | string[] {
  const rawValue = value?.trim() || (nodeEnv === 'production' ? '' : 'http://localhost:8081,http://127.0.0.1:8081');

  if (!rawValue) {
    throw new Error('CORS_ORIGIN is required in production');
  }

  if (rawValue === '*') {
    if (nodeEnv === 'production') {
      throw new Error('CORS_ORIGIN cannot be "*" in production');
    }

    return '*';
  }

  return rawValue.split(',').map((item) => {
    const candidate = item.trim();
    let parsed: URL;

    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`Invalid CORS origin: ${candidate}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== candidate) {
      throw new Error(`CORS origins must be exact http(s) origins: ${candidate}`);
    }

    return parsed.origin;
  });
}

function parseChapterQuality(value: string | undefined): ChapterQuality {
  return value === 'data-saver' ? 'data-saver' : 'data';
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  const normalized = value?.trim();

  if (!normalized || normalized.toLowerCase() === 'false') {
    return false;
  }

  if (normalized.toLowerCase() === 'true') {
    return true;
  }

  if (/^\d+$/.test(normalized)) {
    return parseIntegerInRange('TRUST_PROXY', normalized, 0, 0, 16);
  }

  return normalized;
}

export const env = {
  port: parseIntegerInRange('PORT', process.env.PORT, 3000, 1, 65535),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV ?? 'development'),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  includeErrorStacks: parseBoolean(process.env.INCLUDE_ERROR_STACKS, false),
  rateLimitWindowMs: parseIntegerInRange(
    'RATE_LIMIT_WINDOW_MS',
    process.env.RATE_LIMIT_WINDOW_MS,
    60000,
    1000,
    3600000
  ),
  rateLimitMaxRequests: parseIntegerInRange(
    'RATE_LIMIT_MAX_REQUESTS',
    process.env.RATE_LIMIT_MAX_REQUESTS,
    120,
    10,
    10000
  ),
  rateLimitMaxKeys: parseIntegerInRange(
    'RATE_LIMIT_MAX_KEYS',
    process.env.RATE_LIMIT_MAX_KEYS,
    10000,
    100,
    1000000
  ),
  imageProxyRateLimitMaxRequests: parseIntegerInRange(
    'IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS',
    process.env.IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS,
    90,
    10,
    10000
  ),
  requestTimeoutMs: parseIntegerInRange('REQUEST_TIMEOUT_MS', process.env.REQUEST_TIMEOUT_MS, 15000, 1000, 120000),
  sourceSearchTimeoutMs: parseIntegerInRange(
    'SOURCE_SEARCH_TIMEOUT_MS',
    process.env.SOURCE_SEARCH_TIMEOUT_MS,
    4500,
    500,
    30000
  ),
  imageProxyMaxBytes: parseIntegerInRange(
    'IMAGE_PROXY_MAX_BYTES',
    process.env.IMAGE_PROXY_MAX_BYTES,
    15728640,
    1048576,
    52428800
  ),
  imageProxyConcurrency: parseIntegerInRange(
    'IMAGE_PROXY_CONCURRENCY',
    process.env.IMAGE_PROXY_CONCURRENCY,
    3,
    1,
    20
  ),
  imageProxyMaxQueue: parseIntegerInRange(
    'IMAGE_PROXY_MAX_QUEUE',
    process.env.IMAGE_PROXY_MAX_QUEUE,
    60,
    1,
    1000
  ),
  imageProxyRequestDelayMs: parseIntegerInRange(
    'IMAGE_PROXY_REQUEST_DELAY_MS',
    process.env.IMAGE_PROXY_REQUEST_DELAY_MS,
    75,
    0,
    5000
  ),
  scraperRequestDelayMs: parseNumber(process.env.SCRAPER_REQUEST_DELAY_MS, 350),
  queryCacheTtlMs: parseNumber(process.env.QUERY_CACHE_TTL_MS, 120000),
  queryCacheMaxEntries: parseNumber(process.env.QUERY_CACHE_MAX_ENTRIES, 500),
  queryCacheMaxPending: parseIntegerInRange(
    'QUERY_CACHE_MAX_PENDING',
    process.env.QUERY_CACHE_MAX_PENDING,
    100,
    1,
    10000
  ),
  comickMaxQueue: parseIntegerInRange('COMICK_MAX_QUEUE', process.env.COMICK_MAX_QUEUE, 40, 1, 1000),
  translationEnabled: parseBoolean(process.env.TRANSLATION_ENABLED, true),
  translationApiUrl: process.env.TRANSLATION_API_URL ?? 'https://api.mymemory.translated.net/get',
  translationCacheTtlMs: parseNumber(process.env.TRANSLATION_CACHE_TTL_MS, 86400000),
  mangadexBaseUrl: process.env.MANGADEX_BASE_URL ?? 'https://api.mangadex.org',
  comickBaseUrl: process.env.COMICK_BASE_URL ?? 'https://comick.live',
  comickImageBaseUrl: process.env.COMICK_IMAGE_BASE_URL ?? 'https://meo.comick.pictures',
  myMangaOnlineBaseUrl: process.env.MYMANGAONLINE_BASE_URL ?? 'https://mymangaonline.net',
  inmangaBaseUrl: process.env.INMANGA_BASE_URL ?? 'https://inmanga.com',
  tuMangaOnlineBaseUrl: process.env.TUMANGAONLINE_BASE_URL ?? 'https://lectortmo.vip',
  leerMangaBaseUrl: process.env.LEERMANGA_BASE_URL ?? 'https://leermanga.net',
  mangadexDefaultLanguage: process.env.MANGADEX_DEFAULT_LANGUAGE ?? 'es',
  allowedLanguages: parseCsv(process.env.ALLOWED_LANGUAGES, ['es', 'en', 'pt-br', 'fr']),
  defaultChapterQuality: parseChapterQuality(process.env.DEFAULT_CHAPTER_QUALITY),
  providers: {
    myMangaOnline: parseBoolean(process.env.MYMANGAONLINE_PROVIDER_ENABLED, false),
    inmanga: parseBoolean(process.env.INMANGA_PROVIDER_ENABLED, false),
    leerManga: parseBoolean(process.env.LEERMANGA_PROVIDER_ENABLED, false),
    tuMangaOnline: parseBoolean(process.env.TUMANGAONLINE_PROVIDER_ENABLED, false)
  },
  sources: {
    mangadex: parseBoolean(process.env.MANGADEX_ENABLED, true),
    inmanga: parseBoolean(process.env.INMANGA_ENABLED, false),
    leerManga: parseBoolean(process.env.LEERMANGA_ENABLED, false),
    tuMangaOnline: parseBoolean(process.env.TUMANGAONLINE_ENABLED, false),
    comick: parseBoolean(process.env.COMICK_ENABLED, false),
    mangaScraper: parseBoolean(process.env.MANGA_SCRAPER_ENABLED, false),
    mangpi: parseBoolean(process.env.MANGPI_ENABLED, false)
  }
};
