import { AxiosError } from 'axios';

import { env } from '../../config/env';
import {
  ChapterOptions,
  ChapterPageOptions,
  MangaLibraryOptions,
  NormalizedChapter,
  NormalizedManga,
  NormalizedMangaDetails,
  NormalizedMangaLibraryPage,
  NormalizedPage,
  SearchOptions,
  SourceOptions
} from '../../types/manga.types';
import { filterAsyncWithConcurrency } from '../../utils/async';
import { createCacheKey, TtlCache } from '../../utils/cache';
import { ExternalApiError } from '../../utils/errors';
import { httpClient } from '../../utils/httpClient';
import { normalizeStatus } from '../../utils/normalize';
import { MangaSource } from './mangaSource.interface';

type ComickTitle = {
  title?: string | null;
};

type ComickGenre = {
  name?: string | null;
  slug?: string | null;
};

type ComickGenreRelationship = {
  md_genres?: ComickGenre | null;
};

type ComickAuthorRelationship = {
  md_authors?: {
    name?: string | null;
  } | null;
};

type ComickCover = {
  b2key?: string | null;
};

type ComickComic = {
  id?: number | string;
  hid?: string;
  slug?: string;
  title?: string | null;
  desc?: string | null;
  description?: string | null;
  status?: number | string | null;
  year?: number | null;
  country?: string | null;
  cover_url?: string | null;
  md_covers?: ComickCover[] | null;
  md_titles?: ComickTitle[] | null;
  md_comic_md_genres?: ComickGenreRelationship[] | null;
  md_comic_md_authors?: ComickAuthorRelationship[] | null;
  chapters_count?: number | null;
  chapter_count?: number | null;
  chapter_latest_by_langs?: Record<string, unknown> | null;
  lang_list?: string | string[] | null;
  last_chapter?: number | string | null;
  default_thumbnail?: string | null;
};

type ComickComicDetailsResponse = {
  comic?: ComickComic;
  chapters?: ComickChapter[];
};

type ComickSearchComic = ComickComic & {
  slug: string;
  title: string;
  default_thumbnail?: string | null;
};

type ComickSearchResponse = {
  data?: ComickSearchComic[];
  next_cursor?: string | null;
} | ComickSearchComic[] | {
  comics?: ComickComic[];
};

type ComickChapter = {
  id?: number | string;
  hid?: string;
  chap?: string | null;
  title?: string | null;
  vol?: string | null;
  lang?: string | null;
  publish_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  md_images_count?: number | null;
  images_count?: number | null;
};

type ComickChaptersResponse = {
  data?: ComickChapter[];
  chapters?: ComickChapter[];
  total?: number;
};

type ComickImage = {
  b2key?: string | null;
  url?: string | null;
  w?: number | null;
  h?: number | null;
};

type ComickChapterPagesResponse = {
  chapter?: {
    images?: ComickImage[] | null;
    md_images?: ComickImage[] | null;
  };
  images?: ComickImage[] | null;
  md_images?: ComickImage[] | null;
};

function getComickErrorMessage(error: unknown) {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (status === 403) {
      return 'Comick blocked the server-side request with status 403. Try COMICK_BASE_URL=https://comick.art or disable COMICK_ENABLED.';
    }

    const detail = error.code ?? error.message;

    return status ? `Comick request failed with status ${status}` : `Comick request failed: ${detail}`;
  }

  return 'Comick request failed';
}

function getComickRequestHeaders() {
  return {
    Accept: 'application/json',
    Origin: env.comickBaseUrl,
    Referer: `${env.comickBaseUrl}/`,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  };
}

function normalizeComickStatus(status: number | string | null | undefined) {
  if (typeof status === 'number') {
    const statusByCode: Record<number, string> = {
      1: 'ongoing',
      2: 'completed',
      3: 'cancelled',
      4: 'hiatus'
    };

    return normalizeStatus(statusByCode[status]);
  }

  return normalizeStatus(status?.toLowerCase());
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function asArray<TValue>(value: TValue[] | null | undefined): TValue[] {
  return Array.isArray(value) ? value : [];
}

function getComickLanguageVariants(language: string) {
  const normalizedLanguage = language.toLowerCase();

  if (normalizedLanguage === 'es') {
    return ['es', 'es-419', 'es-la'];
  }

  if (normalizedLanguage === 'pt-br') {
    return ['pt-br', 'pt'];
  }

  return [normalizedLanguage];
}

function isSpanishLanguage(language: string) {
  return getComickLanguageVariants(language).some((variant) => variant === 'es' || variant === 'es-419');
}

const COMICK_SPANISH_DISCOVERY_QUERIES = [
  'leveling',
  'villain',
  'duke',
  'sword',
  'magic',
  'dragon',
  'reincarnation',
  'romance',
  'academy',
  'hunter',
  'tower',
  'ranker',
  'return',
  'player',
  'dungeon',
  'necromancer',
  'emperor',
  'martial',
  'knight',
  'princess',
  'villainess',
  'marriage',
  'solo',
  'max',
  'god',
  'hero',
  'legend',
  'northern'
];
const COMICK_LIBRARY_DISCOVERY_PAGES = 1;
const COMICK_LIBRARY_TOTAL_BUFFER_PAGES = 2;
const COMICK_LIBRARY_MIN_TOTAL = 270;
const COMICK_DISCOVERY_QUERY_LIMIT = 50;
const COMICK_CHAPTER_SCAN_PAGES = 6;
const COMICK_CHAPTER_CACHE_VERSION = 'scan-v4';
const COMICK_REQUEST_ATTEMPTS = 3;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryComickRequest(error: unknown) {
  if (!(error instanceof AxiosError)) {
    return false;
  }

  const status = error.response?.status;

  return status === 429 || (typeof status === 'number' && status >= 500) || (!status && Boolean(error.code));
}

function getComickRetryDelay(error: unknown, attempt: number) {
  const retryAfterHeader = error instanceof AxiosError ? error.response?.headers?.['retry-after'] : undefined;
  const retryAfterValue = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
  const retryAfterSeconds =
    typeof retryAfterValue === 'string' && retryAfterValue.trim() ? Number(retryAfterValue) : Number.NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 15000);
  }

  if (error instanceof AxiosError && error.response?.status === 429) {
    return env.scraperRequestDelayMs * 8 * (attempt + 1);
  }

  return env.scraperRequestDelayMs * (attempt + 2);
}

function resolveComicDetails(data: ComickComicDetailsResponse | ComickComic): ComickComic {
  return isComickComicDetailsResponse(data) && data.comic ? data.comic : (data as ComickComic);
}

function resolveEmbeddedChapters(data: ComickComicDetailsResponse | ComickComic) {
  return isComickComicDetailsResponse(data) ? data.chapters : undefined;
}

function isComickComicDetailsResponse(data: ComickComicDetailsResponse | ComickComic): data is ComickComicDetailsResponse {
  return 'comic' in data || 'chapters' in data;
}

function resolveSearchComics(data: ComickSearchResponse): ComickComic[] {
  if (Array.isArray(data)) {
    return data;
  }

  if ('data' in data && data.data) {
    return data.data;
  }

  if ('comics' in data && data.comics) {
    return data.comics;
  }

  return [];
}

export class ComickService implements MangaSource {
  public readonly id = 'comick';
  public readonly name = 'Comick';
  public readonly enabled: boolean;
  public readonly supportsSpanish = true;
  public readonly supportsPages = true;
  private readonly baseUrl = env.comickBaseUrl;
  private readonly imageBaseUrl = env.comickImageBaseUrl;
  private readonly cache = new TtlCache<unknown>(env.queryCacheTtlMs, env.queryCacheMaxEntries);
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  async searchManga(query: string, options: SearchOptions = {}): Promise<NormalizedManga[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const limit = options.limit ?? 20;

    return this.cached(['searchManga', query.trim().toLowerCase(), lang, limit], async () => {
      try {
        const data = await this.requestSearch(query, limit);
        const comics = resolveSearchComics(data);
        const readableComics = await this.filterComicsWithReadableLanguage(comics, lang);

        return readableComics.map((comic) => this.mapManga(comic, lang));
      } catch (error) {
        throw new ExternalApiError(getComickErrorMessage(error));
      }
    });
  }

  async getMangaLibrary(options: MangaLibraryOptions = {}): Promise<NormalizedMangaLibraryPage> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const limit = Math.min(Math.max(options.limit ?? 15, 1), 100);
    const page = Math.max(options.page ?? 0, 0);
    const offset = page * limit;
    const requestLimit = Math.min(Math.max((page + 1) * limit * 2, limit), 100);
    const sort = options.sort ?? 'popular';

    return this.cached(['getMangaLibrary', 'discovery-v10', lang, limit, page, sort], async () => {
      try {
        const data = await this.requestSearch(
          '',
          requestLimit,
          sort === 'recentlyUpdated' ? 'last_chapter_at' : 'user_follow_count'
        );
        const comics = resolveSearchComics(data);
        const readableComics = await this.filterComicsWithReadableLanguage(comics, lang, {
          validateUnknownMetadata: false
        });
        const basePageComics = readableComics.slice(offset, offset + limit);
        const discoveryComics =
          isSpanishLanguage(lang) && basePageComics.length < limit
            ? await this.getSpanishDiscoveryPageComics(
                lang,
                sort,
                page,
                limit - basePageComics.length,
                readableComics
              )
            : [];
        const pageComics = this.mergeComics(basePageComics, discoveryComics).slice(0, limit);
        const mappedMangas = pageComics.map((comic) =>
          this.mapLibraryManga(comic, lang)
        );
        const hasMorePages = pageComics.length === limit;

        return {
          source: this.id,
          lang,
          mangas: mappedMangas,
          total: hasMorePages
            ? Math.max(COMICK_LIBRARY_MIN_TOTAL, offset + limit * COMICK_LIBRARY_TOTAL_BUFFER_PAGES)
            : offset + mappedMangas.length,
          limit,
          offset
        };
      } catch (error) {
        throw new ExternalApiError(getComickErrorMessage(error));
      }
    });
  }

  async getMangaDetails(id: string, options: SourceOptions = {}): Promise<NormalizedMangaDetails> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    return this.cached(['getMangaDetails', id, lang], async () => {
      try {
        const data = await this.requestComicData(id);
        const comic = resolveComicDetails(data);
        const embeddedChapters = resolveEmbeddedChapters(data);

        return this.mapMangaDetails(comic, id, lang, embeddedChapters);
      } catch (error) {
        const fallbackComic = await this.findComicById(id);

        if (fallbackComic) {
          return this.mapMangaDetails(fallbackComic, id, lang);
        }

        throw new ExternalApiError(getComickErrorMessage(error));
      }
    });
  }

  async getChapters(mangaId: string, options: ChapterOptions = {}): Promise<NormalizedChapter[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const limit = options.limit ?? 100;
    const page = Math.floor((options.offset ?? 0) / limit) + 1;

    return this.cached(['getChapters', COMICK_CHAPTER_CACHE_VERSION, mangaId, lang, page, limit], async () => {
      try {
        const canonicalMangaId = await this.getCanonicalMangaId(mangaId);
        const chapters = await this.getReadableChapters(canonicalMangaId, {
          lang,
          page,
          limit
        });

        return chapters
          .map((chapter) => this.mapChapter(chapter, canonicalMangaId, chapter.lang ?? lang))
          .filter((chapter) => chapter.id);
      } catch (error) {
        throw new ExternalApiError(getComickErrorMessage(error));
      }
    });
  }

  async getChapterPages(chapterId: string, _options?: ChapterPageOptions): Promise<NormalizedPage[]> {
    return this.cached(['getChapterPages', chapterId], async () => {
      try {
        const response = await this.runComickRequest(() =>
          httpClient.get<string>(`${this.baseUrl}/comic/${chapterId}`, {
            headers: getComickRequestHeaders(),
            responseType: 'text'
          })
        );
        const data = this.extractJsonFromHtml<ComickChapterPagesResponse>(response.data, 'sv-data');
        const images = data.chapter?.images ?? data.chapter?.md_images ?? data.images ?? data.md_images ?? [];

        return images
          .map((image, index) => this.mapPage(image, index))
          .filter((page): page is NormalizedPage => page !== null);
      } catch (error) {
        throw new ExternalApiError(getComickErrorMessage(error));
      }
    });
  }

  private mapManga(comic: ComickComic, language: string): NormalizedManga {
    return {
      id: comic.slug ?? comic.hid ?? String(comic.id ?? ''),
      source: this.id,
      title: comic.title ?? comic.slug ?? '',
      alternativeTitles: uniqueStrings(asArray(comic.md_titles).map((title) => title.title)),
      description: comic.desc ?? comic.description ?? '',
      cover: this.buildImageUrl(comic.cover_url ?? comic.default_thumbnail ?? asArray(comic.md_covers)[0]?.b2key),
      status: normalizeComickStatus(comic.status),
      year: typeof comic.year === 'number' && comic.year > 0 ? comic.year : null,
      genres: this.getGenres(comic),
      language,
      raw: comic
    };
  }

  private mapLibraryManga(comic: ComickComic, language: string): NormalizedManga {
    return {
      id: comic.slug ?? comic.hid ?? String(comic.id ?? ''),
      source: this.id,
      title: comic.title ?? comic.slug ?? '',
      alternativeTitles: [],
      description: '',
      cover: this.buildImageUrl(comic.cover_url ?? comic.default_thumbnail ?? asArray(comic.md_covers)[0]?.b2key),
      status: normalizeComickStatus(comic.status),
      year: typeof comic.year === 'number' && comic.year > 0 ? comic.year : null,
      genres: [],
      language
    };
  }

  private async mapMangaDetails(
    comic: ComickComic,
    requestedId: string,
    language: string,
    embeddedChapters?: ComickChapter[]
  ): Promise<NormalizedMangaDetails> {
    const manga = this.mapManga(comic, language);
    const mangaId = comic.slug ?? comic.hid ?? String(comic.id ?? requestedId);
    const knownChapterCount = comic.chapters_count ?? comic.chapter_count;

    return {
      ...manga,
      authors: this.getAuthors(comic),
      artists: this.getAuthors(comic),
      chaptersCount:
        typeof knownChapterCount === 'number' && knownChapterCount >= 0
          ? knownChapterCount
          : await this.getLanguageChaptersCount(mangaId, language, embeddedChapters)
    };
  }

  private mapChapter(chapter: ComickChapter, mangaId: string, language: string): NormalizedChapter {
    const chapterPath = `${mangaId}/${chapter.hid ?? chapter.id}-chapter-${chapter.chap ?? ''}-${chapter.lang ?? language}`;

    return {
      id: chapterPath,
      source: this.id,
      mangaId,
      chapter: chapter.chap ?? '',
      title: chapter.title ?? null,
      volume: chapter.vol ?? null,
      language: chapter.lang ?? language,
      pages: chapter.md_images_count ?? chapter.images_count ?? 1,
      publishedAt: chapter.publish_at ?? chapter.created_at ?? chapter.updated_at ?? null,
      raw: chapter
    };
  }

  private mapPage(image: ComickImage, index: number): NormalizedPage | null {
    const url = this.buildImageUrl(image.url ?? image.b2key);

    if (!url) {
      return null;
    }

    return {
      page: index + 1,
      url,
      width: image.w ?? null,
      height: image.h ?? null
    };
  }

  private buildImageUrl(path: string | null | undefined) {
    if (!path) {
      return null;
    }

    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    if (path.startsWith('//')) {
      return `https:${path}`;
    }

    return `${this.imageBaseUrl}/${path.replace(/^\/+/, '')}`;
  }

  private getGenres(comic: ComickComic) {
    return uniqueStrings(
      asArray(comic.md_comic_md_genres).map((genre) => genre.md_genres?.name ?? genre.md_genres?.slug)
    );
  }

  private getAuthors(comic: ComickComic) {
    return uniqueStrings(asArray(comic.md_comic_md_authors).map((author) => author.md_authors?.name));
  }

  private async getCanonicalMangaId(mangaId: string) {
    try {
      const data = await this.requestComicData(mangaId);
      const comic = resolveComicDetails(data);

      return comic.slug ?? comic.hid ?? mangaId;
    } catch {
      const fallbackComic = await this.findComicById(mangaId);

      return fallbackComic?.slug ?? fallbackComic?.hid ?? mangaId;
    }
  }

  private async findComicById(id: string): Promise<ComickComic | null> {
    const normalizedId = id.trim();

    if (!normalizedId) {
      return null;
    }

    const queries = uniqueStrings([normalizedId, normalizedId.replace(/[-_]+/g, ' ')]);

    for (const query of queries) {
      try {
        const data = await this.requestSearch(query, 20);
        const comics = resolveSearchComics(data);
        const exactMatch = comics.find((comic) => this.isSameComic(comic, normalizedId));

        if (exactMatch) {
          return exactMatch;
        }
      } catch {
        // Try the next query form before surfacing the original detail error.
      }
    }

    return null;
  }

  private isSameComic(comic: ComickComic, id: string) {
    const normalizedId = id.toLowerCase();

    return [comic.slug, comic.hid, comic.id === undefined ? undefined : String(comic.id)]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase() === normalizedId);
  }

  private async getSpanishDiscoveryPageComics(
    language: string,
    sort: MangaLibraryOptions['sort'],
    page: number,
    targetCount: number,
    seedComics: ComickComic[] = []
  ) {
    const orderBy = sort === 'recentlyUpdated' ? 'last_chapter_at' : 'user_follow_count';
    const batches: ComickComic[][] = [];
    const seedComicIds = new Set(seedComics.map((comic) => this.getComicId(comic)).filter(Boolean));
    const startIndex = Math.max(page, 0) % COMICK_SPANISH_DISCOVERY_QUERIES.length;
    const maxQueries = Math.min(COMICK_LIBRARY_DISCOVERY_PAGES + 3, COMICK_SPANISH_DISCOVERY_QUERIES.length);

    for (let queryOffset = 0; queryOffset < maxQueries; queryOffset += 1) {
      const query = COMICK_SPANISH_DISCOVERY_QUERIES[
        (startIndex + queryOffset) % COMICK_SPANISH_DISCOVERY_QUERIES.length
      ];
      try {
        const data = await this.requestSearch(query, COMICK_DISCOVERY_QUERY_LIMIT, orderBy);
        const comics = resolveSearchComics(data);
        const readableComics = await this.filterComicsWithReadableLanguage(comics, language, {
          validateUnknownMetadata: false
        });

        batches.push(readableComics);
        const candidates = this.mergeComics(...batches).filter((comic) => !seedComicIds.has(this.getComicId(comic)));

        if (candidates.length >= targetCount) {
          break;
        }
      } catch {
        // Continue with the next discovery term; Comick may reject individual broad searches.
      }
    }

    return this.mergeComics(...batches)
      .filter((comic) => !seedComicIds.has(this.getComicId(comic)))
      .slice(0, targetCount);
  }

  private mergeComics(...comicLists: ComickComic[][]) {
    const merged: ComickComic[] = [];
    const seenComicIds = new Set<string>();

    comicLists.flat().forEach((comic) => {
      const comicId = this.getComicId(comic);

      if (!comicId || seenComicIds.has(comicId)) {
        return;
      }

      seenComicIds.add(comicId);
      merged.push(comic);
    });

    return merged;
  }

  private getComicId(comic: ComickComic) {
    return comic.slug ?? comic.hid ?? String(comic.id ?? '');
  }

  private async filterComicsWithReadableLanguage(
    comics: ComickComic[],
    language: string,
    options: { validateUnknownMetadata?: boolean } = {}
  ) {
    const validateUnknownMetadata = options.validateUnknownMetadata ?? true;

    return filterAsyncWithConcurrency(comics, async (comic) => {
      const metadataMatch = this.hasLanguageMetadataMatch(comic, language);

      if (metadataMatch !== null) {
        return metadataMatch;
      }

      if (!validateUnknownMetadata) {
        return false;
      }

      const mangaId = comic.slug ?? comic.hid ?? String(comic.id ?? '');

      if (!mangaId) {
        return false;
      }

      const chapters = await this.getReadableChapters(mangaId, {
        lang: language,
        page: 1,
        limit: 100
      });

      return chapters.length > 0;
    });
  }

  private hasLanguageMetadataMatch(comic: ComickComic, language: string): boolean | null {
    const languageVariants = getComickLanguageVariants(language);
    const languageValues = this.getComicLanguageValues(comic);

    if (languageValues.length === 0) {
      return null;
    }

    return languageValues.some((value) => languageVariants.includes(value));
  }

  private getComicLanguageValues(comic: ComickComic) {
    const values = new Set<string>();

    if (typeof comic.lang_list === 'string') {
      comic.lang_list
        .replace(/[{}]/g, '')
        .split(',')
        .map((language) => language.trim().toLowerCase())
        .filter(Boolean)
        .forEach((language) => values.add(language));
    } else if (Array.isArray(comic.lang_list)) {
      comic.lang_list
        .map((language) => language.trim().toLowerCase())
        .filter(Boolean)
        .forEach((language) => values.add(language));
    }

    Object.keys(comic.chapter_latest_by_langs ?? {}).forEach((language) => {
      values.add(language.toLowerCase());
    });

    return Array.from(values);
  }

  private async getLanguageChaptersCount(
    mangaId: string,
    language: string,
    embeddedChapters: ComickChapter[] | undefined
  ) {
    if (embeddedChapters?.length) {
      const languageChapters = embeddedChapters.filter((chapter) => this.isReadableChapterInLanguage(chapter, language));
      const readableChapters = embeddedChapters.filter((chapter) => this.isReadableChapter(chapter));

      return (languageChapters.length > 0 ? languageChapters : readableChapters).length;
    }

    try {
      const chapters = await this.getReadableChapters(mangaId, {
        lang: language,
        page: 1,
        limit: 100
      });

      return chapters.length;
    } catch {
      return 0;
    }
  }

  private async getReadableChapters(
    mangaId: string,
    params: {
      lang?: string;
      page: number;
      limit: number;
    }
  ) {
    const requestedLanguage = params.lang ?? env.mangadexDefaultLanguage;
    const localizedChapters = await this.getReadableChaptersFromPages(mangaId, requestedLanguage, {
      lang: params.lang,
      page: params.page,
      limit: params.limit
    });

    if (localizedChapters.length > 0 || !params.lang) {
      return localizedChapters;
    }

    return this.getReadableChaptersFromPages(mangaId, undefined, {
      page: params.page,
      limit: params.limit
    });
  }

  private async getReadableChaptersFromPages(
    mangaId: string,
    language: string | undefined,
    params: {
      lang?: string;
      page: number;
      limit: number;
    }
  ) {
    const chapters: ComickChapter[] = [];
    const seenChapterIds = new Set<string>();
    const startPage = Math.max(params.page, 1);
    const limit = Math.max(params.limit, 1);

    for (let page = startPage; page < startPage + COMICK_CHAPTER_SCAN_PAGES; page += 1) {
      if (page > startPage) {
        await wait(env.scraperRequestDelayMs);
      }

      const nextChapters = await this.requestChapters(mangaId, {
        ...params,
        page,
        limit
      });

      nextChapters
        .filter((chapter) =>
          language ? this.isReadableChapterInLanguage(chapter, language) : this.isReadableChapter(chapter)
        )
        .forEach((chapter) => {
          const chapterId = chapter.hid ?? String(chapter.id ?? `${chapter.chap ?? ''}:${chapter.lang ?? ''}`);

          if (seenChapterIds.has(chapterId)) {
            return;
          }

          seenChapterIds.add(chapterId);
          chapters.push(chapter);
        });

      if (nextChapters.length < limit) {
        break;
      }
    }

    return chapters;
  }

  private async requestChapters(
    mangaId: string,
    params: {
      lang?: string;
      page: number;
      limit: number;
    }
  ): Promise<ComickChapter[]> {
    return this.cached(['requestChapters', mangaId, params], async () => {
      const requestParams: Record<string, string | number> = {
        page: params.page,
        limit: params.limit
      };

      if (params.lang) {
        requestParams.lang = params.lang;
      }

      for (let attempt = 0; attempt < COMICK_REQUEST_ATTEMPTS; attempt += 1) {
        try {
          const response = await this.runComickRequest(() =>
            httpClient.get<ComickChaptersResponse>(`${this.baseUrl}/api/comics/${mangaId}/chapter-list`, {
              headers: getComickRequestHeaders(),
              params: requestParams
            })
          );

          return response.data.data ?? response.data.chapters ?? [];
        } catch (error) {
          if (attempt >= COMICK_REQUEST_ATTEMPTS - 1 || !shouldRetryComickRequest(error)) {
            throw error;
          }

          await wait(getComickRetryDelay(error, attempt));
        }
      }

      return [];
    });
  }

  private async requestSearchFromBaseUrl(
    baseUrl: string,
    params: Record<string, string | number>
  ): Promise<ComickSearchResponse> {
    for (let attempt = 0; attempt < COMICK_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.runComickRequest(() =>
          httpClient.get<ComickSearchResponse>(`${baseUrl}/api/search`, {
            headers: getComickRequestHeaders(),
            params
          })
        );

        return response.data;
      } catch (error) {
        if (attempt >= COMICK_REQUEST_ATTEMPTS - 1 || !shouldRetryComickRequest(error)) {
          throw error;
        }

        await wait(getComickRetryDelay(error, attempt));
      }
    }

    return [];
  }

  private isLanguageMatch(value: string | null | undefined, language: string) {
    const sourceLanguage = value?.toLowerCase();
    const languageVariants = getComickLanguageVariants(language);

    if (!sourceLanguage) {
      return false;
    }

    return languageVariants.includes(sourceLanguage);
  }

  private isReadableChapterInLanguage(chapter: ComickChapter, language: string) {
    return this.isReadableChapter(chapter) && (!chapter.lang || this.isLanguageMatch(chapter.lang, language));
  }

  private isReadableChapter(chapter: ComickChapter) {
    const pages = chapter.md_images_count ?? chapter.images_count ?? 1;

    return pages > 0;
  }

  private async requestSearch(query: string, limit: number, orderBy = 'user_follow_count'): Promise<ComickSearchResponse> {
    const params = {
      q: query,
      limit,
      order_by: orderBy,
      order_direction: 'desc',
      showAll: 'false',
      exclude_mylist: 'false',
      type: 'comic'
    };

    try {
      return await this.requestSearchFromBaseUrl(this.baseUrl, params);
    } catch (error) {
      if (error instanceof AxiosError && (error.response?.status === 403 || error.response?.status === 404)) {
        const fallbackBaseUrl = this.baseUrl === 'https://comick.art' ? 'https://comick.live' : 'https://comick.art';
        return this.requestSearchFromBaseUrl(fallbackBaseUrl, params);
      }

      throw error;
    }
  }

  private async requestComicData(id: string): Promise<ComickComicDetailsResponse | ComickComic> {
    return this.cached(['requestComicData', id], async () => {
      const response = await this.runComickRequest(() =>
        httpClient.get<string>(`${this.baseUrl}/comic/${id}`, {
          headers: getComickRequestHeaders(),
          responseType: 'text'
        })
      );

      return this.extractJsonFromHtml<ComickComicDetailsResponse | ComickComic>(response.data, 'comic-data');
    });
  }

  private async runComickRequest<TValue>(loader: () => Promise<TValue>): Promise<TValue> {
    const run = this.requestQueue.then(async () => {
      try {
        return await loader();
      } finally {
        await wait(env.scraperRequestDelayMs);
      }
    });

    this.requestQueue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }

  private cached<TValue>(parts: unknown[], loader: () => Promise<TValue>): Promise<TValue> {
    return this.cache.getOrSet(createCacheKey(this.id, ...parts), loader) as Promise<TValue>;
  }

  private extractJsonFromHtml<TData>(html: string, elementId: string): TData {
    const pattern = new RegExp(`<script[^>]+id=["']${elementId}["'][^>]*>([\\s\\S]*?)<\\/script>`);
    const match = html.match(pattern);

    if (!match?.[1]) {
      throw new ExternalApiError(`Comick response did not include #${elementId}`);
    }

    return JSON.parse(match[1]) as TData;
  }
}
