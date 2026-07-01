import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { mangaAggregatorService } from '../services/mangaAggregator.service';
import { ChapterQuality } from '../types/manga.types';
import { ValidationError } from '../utils/errors';

function getQueryString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getLanguage(value: unknown) {
  const language = getQueryString(value);
  return language || env.mangadexDefaultLanguage;
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

    const source = getQueryString(request.query.source) || 'mangadex';
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

export async function getMangaDetails(request: Request, response: Response, next: NextFunction) {
  try {
    const { source, id } = request.params;
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
    const { source, chapterId } = request.params;
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
