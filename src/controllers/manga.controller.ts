import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { mangaAggregatorService } from '../services/mangaAggregator.service';
import { providerManager } from '../services/providerManager.service';
import { ChapterQuality } from '../types/manga.types';
import { ValidationError } from '../utils/errors';

function getQueryString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getQueryStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(getQueryString).filter(Boolean);
  }

  const singleValue = getQueryString(value);
  return singleValue ? [singleValue] : [];
}

function getQueryNumber(value: unknown, fallback: number, min: number, max: number) {
  const rawValue = getQueryString(value);
  const parsedValue = rawValue ? Number(rawValue) : fallback;

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsedValue), min), max);
}

function getLanguage(value: unknown) {
  const language = getQueryString(value);
  return language || env.mangadexDefaultLanguage;
}

function getTagMode(value: unknown): 'AND' | 'OR' {
  return getQueryString(value) === 'OR' ? 'OR' : 'AND';
}

function getQuality(value: unknown): ChapterQuality {
  const quality = getQueryString(value);

  if (!quality) {
    return env.defaultChapterQuality;
  }

  if (quality !== 'data' && quality !== 'data-saver') {
    throw new ValidationError('quality must be "data" or "data-saver"');
  }

  return quality;
}

export async function searchManga(request: Request, response: Response, next: NextFunction) {
  try {
    const query = getQueryString(request.query.q);

    if (!query) {
      throw new ValidationError('q is required');
    }

    const source = getQueryString(request.query.source);

    if (!source) {
      const payload = await providerManager.searchAll(query);
      response.json(payload);
      return;
    }

    if (providerManager.hasProvider(source)) {
      const items = await providerManager.searchProvider(source, query);

      response.json({
        query,
        providerId: source,
        items
      });
      return;
    }

    const lang = getLanguage(request.query.lang);
    const items = await mangaAggregatorService.searchInSource(source, query, { lang });

    response.json({
      query,
      source,
      lang,
      items
    });
  } catch (error) {
    next(error);
  }
}

export async function searchProviderManga(request: Request, response: Response, next: NextFunction) {
  try {
    const query = getQueryString(request.query.q);

    if (!query) {
      throw new ValidationError('q is required');
    }

    const { providerId } = request.params;
    const items = await providerManager.searchProvider(providerId, query);

    response.json({
      query,
      providerId,
      items
    });
  } catch (error) {
    next(error);
  }
}

export async function searchAllManga(request: Request, response: Response, next: NextFunction) {
  try {
    const query = getQueryString(request.query.q);

    if (!query) {
      throw new ValidationError('q is required');
    }

    const lang = getLanguage(request.query.lang);
    const payload = await mangaAggregatorService.searchAll(query, { lang });

    response.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getMangaLibrary(request: Request, response: Response, next: NextFunction) {
  try {
    const lang = getLanguage(request.query.lang);
    const page = getQueryNumber(request.query.page, 0, 0, 10000);
    const limit = getQueryNumber(request.query.limit, 15, 1, 100);
    const tagIds = getQueryStringArray(request.query.tagIds ?? request.query['tagIds[]']);
    const tagMode = getTagMode(request.query.tagMode);
    const payload = await mangaAggregatorService.getMangaLibrary({ lang, page, limit, tagIds, tagMode });

    response.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getMangaTags(request: Request, response: Response, next: NextFunction) {
  try {
    const lang = getLanguage(request.query.lang);
    const tags = await mangaAggregatorService.getMangaTags({ lang });

    response.json({
      source: 'mangadex',
      lang,
      tags
    });
  } catch (error) {
    next(error);
  }
}

export async function getMangaDetails(request: Request, response: Response, next: NextFunction) {
  try {
    const { source, id } = request.params;

    if (providerManager.hasProvider(source)) {
      const manga = await providerManager.getMangaDetails(source, id);
      response.json(manga);
      return;
    }

    const lang = getLanguage(request.query.lang);
    const manga = await mangaAggregatorService.getMangaDetails(source, id, { lang });

    response.json(manga);
  } catch (error) {
    next(error);
  }
}

export async function getMangaChapters(request: Request, response: Response, next: NextFunction) {
  try {
    const { source, id } = request.params;

    if (providerManager.hasProvider(source)) {
      const chapters = await providerManager.getChapters(source, id);

      response.json({
        providerId: source,
        mangaId: id,
        chapters
      });
      return;
    }

    const lang = getLanguage(request.query.lang);
    const chapters = await mangaAggregatorService.getChapters(source, id, { lang });

    response.json({
      source,
      mangaId: id,
      lang,
      chapters
    });
  } catch (error) {
    next(error);
  }
}

export async function getChapterPages(request: Request, response: Response, next: NextFunction) {
  try {
    const source = request.params.source ?? request.params.providerId;
    const { chapterId } = request.params;

    if (providerManager.hasProvider(source)) {
      const pages = await providerManager.getChapterPages(source, chapterId);

      response.json({
        providerId: source,
        chapterId,
        pages
      });
      return;
    }

    const quality = getQuality(request.query.quality);
    const pages = await mangaAggregatorService.getChapterPages(source, chapterId, { quality });

    response.json({
      source,
      chapterId,
      pages
    });
  } catch (error) {
    next(error);
  }
}
