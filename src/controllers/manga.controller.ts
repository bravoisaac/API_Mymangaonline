import { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { mangaAggregatorService } from '../services/mangaAggregator.service';
import { providerManager } from '../services/providerManager.service';
import { ChapterQuality } from '../types/manga.types';
import {
  getEnumValue,
  getLanguage,
  getOptionalString,
  getQueryInteger,
  getRequiredString,
  getResourceId,
  getSourceId,
  getStringArray
} from '../utils/requestValidation';

function getLibraryQueryOptions(request: Request) {
  return {
    lang: getLanguage(request.query.lang),
    page: getQueryInteger(request.query.page, 'page', 0, 0, 10000),
    limit: getQueryInteger(request.query.limit, 'limit', 15, 1, 100),
    tagIds: getStringArray(request.query.tagIds ?? request.query['tagIds[]'], 'tagIds', {
      maxItems: 20,
      maxItemLength: 64,
      pattern: /^[a-z0-9-]+$/i
    }),
    tagMode: getEnumValue(request.query.tagMode, 'tagMode', ['AND', 'OR'] as const, 'AND'),
    sort: getEnumValue(request.query.sort, 'sort', ['popular', 'recentlyUpdated'] as const, 'popular'),
    source: getEnumValue(request.query.source, 'source', ['all', 'mangadex', 'comick'] as const, 'all')
  };
}

function getQuality(value: unknown): ChapterQuality {
  if (value === undefined) {
    return env.defaultChapterQuality;
  }

  return getEnumValue(value, 'quality', ['data', 'data-saver'] as const, env.defaultChapterQuality);
}

export async function searchManga(request: Request, response: Response, next: NextFunction) {
  try {
    const query = getRequiredString(request.query.q, 'q', { maxLength: 120 });
    const source = getOptionalString(request.query.source, 'source', {
      maxLength: 40,
      pattern: /^[a-z0-9][a-z0-9-]*$/i
    });

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
    const query = getRequiredString(request.query.q, 'q', { maxLength: 120 });
    const providerId = getSourceId(request.params.providerId, 'providerId');
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
    const query = getRequiredString(request.query.q, 'q', { maxLength: 120 });

    const lang = getLanguage(request.query.lang);
    const payload = await mangaAggregatorService.searchAll(query, { lang });

    response.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getMangaLibrary(request: Request, response: Response, next: NextFunction) {
  try {
    const payload = await mangaAggregatorService.getMangaLibrary(getLibraryQueryOptions(request));

    response.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getAggregatedMangaLibrary(request: Request, response: Response, next: NextFunction) {
  try {
    const payload = await mangaAggregatorService.getAggregatedMangaLibrary(getLibraryQueryOptions(request));

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
    const source = getSourceId(request.params.source);
    const id = getResourceId(request.params.id, 'id');

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
    const source = getSourceId(request.params.source);
    const id = getResourceId(request.params.id, 'id');

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
    const limit = getQueryInteger(request.query.limit, 'limit', 10, 1, 100);
    const offset = getQueryInteger(request.query.offset, 'offset', 0, 0, 100000);
    const order = getEnumValue(request.query.order, 'order', ['asc', 'desc'] as const, 'asc');
    const [chapters, manga] = await Promise.all([
      mangaAggregatorService.getChapters(source, id, { lang, limit, offset, order }),
      mangaAggregatorService.getMangaDetails(source, id, { lang }).catch(() => null)
    ]);

    response.json({
      source,
      mangaId: id,
      lang,
      chapters,
      total: manga?.chaptersCount ?? offset + chapters.length,
      limit,
      offset
    });
  } catch (error) {
    next(error);
  }
}

export async function getChapterPages(request: Request, response: Response, next: NextFunction) {
  try {
    const source = getSourceId(request.params.source ?? request.params.providerId);
    const chapterId = getResourceId(request.params.chapterId, 'chapterId');

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
