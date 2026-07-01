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

function parseChapterQuality(value: string | undefined): ChapterQuality {
  return value === 'data-saver' ? 'data-saver' : 'data';
}

export const env = {
  port: parseNumber(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 15000),
  mangadexBaseUrl: process.env.MANGADEX_BASE_URL ?? 'https://api.mangadex.org',
  comickBaseUrl: process.env.COMICK_BASE_URL ?? 'https://comick.live',
  comickImageBaseUrl: process.env.COMICK_IMAGE_BASE_URL ?? 'https://meo.comick.pictures',
  mangadexDefaultLanguage: process.env.MANGADEX_DEFAULT_LANGUAGE ?? 'es',
  defaultChapterQuality: parseChapterQuality(process.env.DEFAULT_CHAPTER_QUALITY),
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
