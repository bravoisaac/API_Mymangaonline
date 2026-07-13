import { AxiosError, AxiosRequestConfig } from 'axios';

import { env } from '../../config/env';
import {
  ChapterOptions,
  ChapterPageOptions,
  ChapterQuality,
  MangaLibraryOptions,
  NormalizedChapter,
  NormalizedManga,
  NormalizedMangaDetails,
  NormalizedMangaLibraryPage,
  NormalizedMangaTag,
  NormalizedPage,
  SearchOptions,
  SourceOptions
} from '../../types/manga.types';
import { filterAsyncWithConcurrency } from '../../utils/async';
import { createCacheKey, TtlCache } from '../../utils/cache';
import { ExternalApiError } from '../../utils/errors';
import { httpClient } from '../../utils/httpClient';
import { getAlternativeTitles, getLocalizedText, normalizeStatus } from '../../utils/normalize';
import { MangaSource } from './mangaSource.interface';

type MangaDexRelationship = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
};

type MangaDexEntity<TAttributes> = {
  id: string;
  type: string;
  attributes: TAttributes;
  relationships?: MangaDexRelationship[];
};

type MangaDexCollection<TAttributes> = {
  result: string;
  data: MangaDexEntity<TAttributes>[];
  total?: number;
};

type MangaDexSingle<TAttributes> = {
  result: string;
  data: MangaDexEntity<TAttributes>;
};

type MangaAttributes = {
  title?: Record<string, string>;
  altTitles?: Record<string, string>[];
  description?: Record<string, string>;
  status?: string;
  year?: number;
  tags?: MangaDexEntity<TagAttributes>[];
};

type ChapterAttributes = {
  title?: string | null;
  chapter?: string | null;
  volume?: string | null;
  translatedLanguage?: string;
  pages?: number;
  publishAt?: string | null;
  readableAt?: string | null;
};

type TagAttributes = {
  name?: Record<string, string>;
  group?: string;
};

type AtHomeResponse = {
  result: string;
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
  };
};

const MANGADEX_UPLOADS_URL = 'https://uploads.mangadex.org';
const MANGADEX_LANGUAGE_VARIANT_CACHE_VERSION = 'lang-variants-v7';
const MANGADEX_REQUEST_ATTEMPTS = 2;

async function requestMangaDex<TData>(url: string, config?: AxiosRequestConfig) {
  for (let attempt = 0; attempt < MANGADEX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await httpClient.get<TData>(url, config);
    } catch (error) {
      const status = error instanceof AxiosError ? error.response?.status : undefined;
      const isTemporaryError =
        error instanceof AxiosError && (!status || status === 429 || status >= 500);

      if (!isTemporaryError || attempt >= MANGADEX_REQUEST_ATTEMPTS - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw new Error('MangaDex request failed after retries');
}

function getMangaDexLanguageVariants(language: string) {
  const normalizedLanguage = language.toLowerCase();

  if (normalizedLanguage === 'es' || normalizedLanguage === 'es-419' || normalizedLanguage === 'es-la') {
    return ['es', 'es-la'];
  }

  if (normalizedLanguage === 'pt-br') {
    return ['pt-br', 'pt'];
  }

  return [normalizedLanguage];
}

function isSpanishLanguage(language: string) {
  return getMangaDexLanguageVariants(language).some((variant) => variant === 'es' || variant === 'es-la');
}

function deduplicateMangaDexChapters(chapters: NormalizedChapter[]) {
  const chaptersByNumber = new Map<string, NormalizedChapter>();

  chapters.forEach((chapter) => {
    const numericChapter = Number(chapter.chapter);
    const chapterNumber = Number.isFinite(numericChapter)
      ? String(numericChapter)
      : chapter.chapter.trim().toLowerCase();
    const key = chapterNumber || `id:${chapter.id}`;
    const currentChapter = chaptersByNumber.get(key);
    const chapterTimestamp = Date.parse(chapter.publishedAt ?? '');
    const currentTimestamp = Date.parse(currentChapter?.publishedAt ?? '');

    if (!currentChapter || (Number.isFinite(chapterTimestamp) ? chapterTimestamp : 0) > (Number.isFinite(currentTimestamp) ? currentTimestamp : 0)) {
      chaptersByNumber.set(key, chapter);
    }
  });

  return Array.from(chaptersByNumber.values());
}

function getRelationship(entity: MangaDexEntity<unknown>, type: string) {
  return entity.relationships?.find((relationship) => relationship.type === type);
}

function getRelationshipNames(entity: MangaDexEntity<unknown>, type: string) {
  return (
    entity.relationships
      ?.filter((relationship) => relationship.type === type)
      .map((relationship) => relationship.attributes?.name)
      .filter((name): name is string => typeof name === 'string') ?? []
  );
}

function getCoverUrl(entity: MangaDexEntity<MangaAttributes>) {
  const cover = getRelationship(entity, 'cover_art');
  const fileName = cover?.attributes?.fileName;

  return typeof fileName === 'string' ? `${MANGADEX_UPLOADS_URL}/covers/${entity.id}/${fileName}.512.jpg` : null;
}

function getGenres(entity: MangaDexEntity<MangaAttributes>, language: string) {
  return (
    entity.attributes.tags
      ?.filter((tag) => tag.attributes.group === 'genre' || tag.attributes.group === 'theme')
      .map((tag) => getLocalizedText(tag.attributes.name, language))
      .filter(Boolean) ?? []
  );
}

function getMangaDexErrorMessage(error: unknown) {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = error.code ?? error.message;

    return status ? `MangaDex request failed with status ${status}` : `MangaDex request failed: ${detail}`;
  }

  return 'MangaDex request failed';
}

export class MangaDexService implements MangaSource {
  public readonly id = 'mangadex';
  public readonly name = 'MangaDex';
  public readonly enabled = env.sources.mangadex;
  public readonly supportsSpanish = true;
  public readonly supportsPages = true;
  private readonly baseUrl = env.mangadexBaseUrl;
  private readonly cache = new TtlCache<unknown>(env.queryCacheTtlMs, env.queryCacheMaxEntries);

  async searchManga(query: string, options: SearchOptions = {}): Promise<NormalizedManga[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const languageVariants = getMangaDexLanguageVariants(lang);
    const limit = options.limit ?? 20;

    return this.cached(
      ['searchManga', MANGADEX_LANGUAGE_VARIANT_CACHE_VERSION, query.trim().toLowerCase(), lang, limit],
      async () => {
      try {
        const response = await httpClient.get<MangaDexCollection<MangaAttributes>>(`${this.baseUrl}/manga`, {
          params: {
            title: query,
            limit,
            'includes[]': ['cover_art'],
            'availableTranslatedLanguage[]': languageVariants,
            'contentRating[]': ['safe', 'suggestive'],
            hasAvailableChapters: true,
            'order[relevance]': 'desc'
          }
        });

        const mappedMangas = response.data.data.map((entity) => this.mapManga(entity, lang));

        return this.filterMangasWithReadableChapters(mappedMangas, lang);
      } catch (error) {
        throw new ExternalApiError(getMangaDexErrorMessage(error));
      }
    });
  }

  async getMangaDetails(id: string, options: SourceOptions = {}): Promise<NormalizedMangaDetails> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    return this.cached(['getMangaDetails', id, lang], async () => {
      try {
        const response = await requestMangaDex<MangaDexSingle<MangaAttributes>>(`${this.baseUrl}/manga/${id}`, {
          params: {
            'includes[]': ['cover_art', 'author', 'artist']
          }
        });
        const entity = response.data.data;

        const chaptersCount = await this.getChapterCount(id, lang);
        const manga = this.mapManga(entity, lang);

        return {
          ...manga,
          authors: getRelationshipNames(entity, 'author'),
          artists: getRelationshipNames(entity, 'artist'),
          chaptersCount
        };
      } catch (error) {
        throw new ExternalApiError(getMangaDexErrorMessage(error));
      }
    });
  }

  async getChapters(mangaId: string, options: ChapterOptions = {}): Promise<NormalizedChapter[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const languageVariants = getMangaDexLanguageVariants(lang);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const order = options.order ?? 'asc';

    return this.cached(['getChapters', MANGADEX_LANGUAGE_VARIANT_CACHE_VERSION, mangaId, lang, limit, offset, order], async () => {
      try {
        const chapters = await this.requestChapters(mangaId, languageVariants, 100, 0, order);

        const normalizedChapters = deduplicateMangaDexChapters(chapters
          .map((entity) => this.mapChapter(entity, mangaId, lang))
          .filter((chapter) => chapter.pages > 0));

        return normalizedChapters.slice(offset, offset + limit);
      } catch (error) {
        throw new ExternalApiError(getMangaDexErrorMessage(error));
      }
    });
  }

  async getChapterPages(chapterId: string, options: ChapterPageOptions = {}): Promise<NormalizedPage[]> {
    const quality = options.quality ?? env.defaultChapterQuality;

    return this.cached(['getChapterPages', chapterId, quality], async () => {
      try {
        const response = await httpClient.get<AtHomeResponse>(`${this.baseUrl}/at-home/server/${chapterId}`);
        const fileNames = quality === 'data-saver' ? response.data.chapter.dataSaver : response.data.chapter.data;

        return fileNames.map((fileName, index) => ({
          page: index + 1,
          url: this.buildPageUrl(response.data.baseUrl, response.data.chapter.hash, fileName, quality),
          width: null,
          height: null
        }));
      } catch (error) {
        throw new ExternalApiError(getMangaDexErrorMessage(error));
      }
    });
  }

  async getMangaLibrary(options: MangaLibraryOptions = {}): Promise<NormalizedMangaLibraryPage> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const languageVariants = getMangaDexLanguageVariants(lang);
    const limit = Math.min(Math.max(options.limit ?? 15, 1), 100);
    const page = Math.max(options.page ?? 0, 0);
    const offset = page * limit;
    const tagIds = options.tagIds ?? [];
    const sort = options.sort ?? 'popular';
    const params: Record<string, string | string[] | number | boolean> = {
      limit,
      offset,
      'includes[]': ['cover_art'],
      'availableTranslatedLanguage[]': languageVariants,
      'contentRating[]': ['safe', 'suggestive'],
      hasAvailableChapters: true,
      [sort === 'recentlyUpdated' ? 'order[latestUploadedChapter]' : 'order[followedCount]']: 'desc'
    };

    if (tagIds.length > 0) {
      params['includedTags[]'] = tagIds;
    }

    if (tagIds.length > 1) {
      params.includedTagsMode = options.tagMode ?? 'AND';
    }

    return this.cached(['getMangaLibrary', MANGADEX_LANGUAGE_VARIANT_CACHE_VERSION, params], async () => {
      try {
        const response = await httpClient.get<MangaDexCollection<MangaAttributes>>(`${this.baseUrl}/manga`, {
          params
        });
        const mappedMangas = response.data.data.map((entity) => this.mapLibraryManga(entity, lang));
        const readableMangas = isSpanishLanguage(lang)
          ? await this.filterMangasWithReadableChapters(mappedMangas, lang)
          : mappedMangas;

        return {
          source: this.id,
          lang,
          mangas: readableMangas,
          total: response.data.total ?? response.data.data.length,
          limit,
          offset
        };
      } catch (error) {
        throw new ExternalApiError(getMangaDexErrorMessage(error));
      }
    });
  }

  async getMangaTags(language = env.mangadexDefaultLanguage): Promise<NormalizedMangaTag[]> {
    return this.cached(['getMangaTags', language], async () => {
      try {
        const response = await httpClient.get<MangaDexCollection<TagAttributes>>(`${this.baseUrl}/manga/tag`);

        return response.data.data
          .map((entity) => ({
            id: entity.id,
            name: getLocalizedText(entity.attributes.name, language),
            group: entity.attributes.group ?? ''
          }))
          .filter((tag) => (tag.group === 'genre' || tag.group === 'theme') && tag.name)
          .sort((first, second) => first.name.localeCompare(second.name));
      } catch (error) {
        throw new ExternalApiError(getMangaDexErrorMessage(error));
      }
    });
  }

  private mapManga(entity: MangaDexEntity<MangaAttributes>, language: string): NormalizedManga {
    return {
      id: entity.id,
      source: this.id,
      title: getLocalizedText(entity.attributes.title, language),
      alternativeTitles: getAlternativeTitles(entity.attributes.altTitles),
      description: getLocalizedText(entity.attributes.description, language),
      cover: getCoverUrl(entity),
      status: normalizeStatus(entity.attributes.status),
      year: entity.attributes.year ?? null,
      genres: getGenres(entity, language),
      language,
      raw: entity
    };
  }

  private mapLibraryManga(entity: MangaDexEntity<MangaAttributes>, language: string): NormalizedManga {
    return {
      id: entity.id,
      source: this.id,
      title: getLocalizedText(entity.attributes.title, language),
      alternativeTitles: [],
      description: '',
      cover: getCoverUrl(entity),
      status: normalizeStatus(entity.attributes.status),
      year: entity.attributes.year ?? null,
      genres: [],
      language
    };
  }

  private mapChapter(entity: MangaDexEntity<ChapterAttributes>, mangaId: string, language: string): NormalizedChapter {
    return {
      id: entity.id,
      source: this.id,
      mangaId,
      chapter: entity.attributes.chapter ?? '',
      title: entity.attributes.title ?? null,
      volume: entity.attributes.volume ?? null,
      language: entity.attributes.translatedLanguage ?? language,
      pages: entity.attributes.pages ?? 0,
      publishedAt: entity.attributes.publishAt ?? entity.attributes.readableAt ?? null,
      raw: entity
    };
  }

  private buildPageUrl(baseUrl: string, hash: string, fileName: string, quality: ChapterQuality) {
    return `${baseUrl}/${quality}/${hash}/${fileName}`;
  }

  private async getChapterCount(mangaId: string, language: string) {
    const chapters = await this.getChapters(mangaId, {
      lang: language,
      limit: 100,
      offset: 0,
      order: 'asc'
    });

    return chapters.length;
  }

  private async requestChapters(
    mangaId: string,
    languages: string[] | undefined,
    limit: number,
    offset: number,
    order: 'asc' | 'desc'
  ) {
    const params: Record<string, string | string[] | number> = {
      limit,
      offset,
      'order[chapter]': order
    };

    if (languages?.length) {
      params['translatedLanguage[]'] = languages;
    }

    const response = await requestMangaDex<MangaDexCollection<ChapterAttributes>>(`${this.baseUrl}/manga/${mangaId}/feed`, {
      params
    });

    return response.data.data;
  }

  private async hasReadableChapters(mangaId: string, language: string) {
    const languageVariants = getMangaDexLanguageVariants(language);

    return this.cached(['hasReadableChapters', MANGADEX_LANGUAGE_VARIANT_CACHE_VERSION, mangaId, language], async () => {
      try {
        const response = await httpClient.get<MangaDexCollection<ChapterAttributes>>(`${this.baseUrl}/manga/${mangaId}/feed`, {
          params: {
            limit: 10,
            offset: 0,
            'translatedLanguage[]': languageVariants,
            'order[chapter]': 'asc'
          }
        });

        return response.data.data.some((entity) => (entity.attributes.pages ?? 0) > 0);
      } catch {
        return false;
      }
    });
  }

  private async filterMangasWithReadableChapters(mangas: NormalizedManga[], language: string) {
    return filterAsyncWithConcurrency(mangas, (manga) => this.hasReadableChapters(manga.id, language));
  }

  private cached<TValue>(parts: unknown[], loader: () => Promise<TValue>): Promise<TValue> {
    return this.cache.getOrSet(createCacheKey(this.id, ...parts), loader) as Promise<TValue>;
  }
}
