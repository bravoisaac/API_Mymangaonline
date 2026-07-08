import {
  AggregatedMangaLibraryPage,
  ChapterOptions,
  ChapterPageOptions,
  MangaLibraryOptions,
  NormalizedChapter,
  NormalizedManga,
  NormalizedMangaDetails,
  NormalizedMangaLibraryPage,
  NormalizedMangaTag,
  NormalizedPage,
  SearchOptions,
  SourceOptions
} from '../types/manga.types';
import { AggregatedSearchResult, SourceErrorResult, SourceMetadata } from '../types/source.types';
import { AppError, SourceNotFoundError, SourceNotImplementedError } from '../utils/errors';
import { ComickService } from './sources/comick.service';
import { InmangaService } from './sources/inmanga.service';
import { LeerMangaService } from './sources/leerManga.service';
import { MangaScraperService } from './sources/mangaScraper.service';
import { MangaSource } from './sources/mangaSource.interface';
import { MangaDexService } from './sources/mangadex.service';
import { MangpiService } from './sources/mangpi.service';
import { TuMangaOnlineService } from './sources/tuMangaOnline.service';
import { env } from '../config/env';

export class MangaAggregatorService {
  private readonly sources: Map<string, MangaSource>;

  constructor() {
    const sourceList: MangaSource[] = [
      new MangaDexService(),
      new InmangaService(env.sources.inmanga),
      new LeerMangaService(env.sources.leerManga),
      new TuMangaOnlineService(env.sources.tuMangaOnline),
      new ComickService(env.sources.comick),
      new MangaScraperService(env.sources.mangaScraper),
      new MangpiService(env.sources.mangpi)
    ];

    this.sources = new Map(sourceList.map((source) => [source.id, source]));
  }

  listSources(): SourceMetadata[] {
    return Array.from(this.sources.values()).map((source) => ({
      id: source.id,
      name: source.name,
      enabled: source.enabled,
      supportsSpanish: source.supportsSpanish,
      supportsPages: source.supportsPages
    }));
  }

  getSource(sourceId: string): MangaSource {
    const source = this.sources.get(sourceId);

    if (!source) {
      throw new SourceNotFoundError(sourceId);
    }

    return source;
  }

  async searchInSource(sourceId: string, query: string, options?: SearchOptions): Promise<NormalizedManga[]> {
    const source = this.getEnabledSource(sourceId);
    return source.searchManga(query, options);
  }

  async searchAll(
    query: string,
    options?: SearchOptions
  ): Promise<{
    query: string;
    lang: string;
    results: AggregatedSearchResult<NormalizedManga>[];
    errors: SourceErrorResult[];
  }> {
    const enabledSources = Array.from(this.sources.values()).filter((source) => source.enabled);
    const results: AggregatedSearchResult<NormalizedManga>[] = [];
    const errors: SourceErrorResult[] = [];

    await Promise.all(
      enabledSources.map(async (source) => {
        try {
          const items = await source.searchManga(query, options);
          results.push({ source: source.id, items });
        } catch (error) {
          errors.push({
            source: source.id,
            message: error instanceof Error ? error.message : 'Unknown source error'
          });
        }
      })
    );

    return {
      query,
      lang: options?.lang ?? env.mangadexDefaultLanguage,
      results,
      errors
    };
  }

  async getMangaDetails(
    sourceId: string,
    mangaId: string,
    options?: SourceOptions
  ): Promise<NormalizedMangaDetails> {
    const source = this.getEnabledSource(sourceId);
    return source.getMangaDetails(mangaId, options);
  }

  async getChapters(sourceId: string, mangaId: string, options?: ChapterOptions): Promise<NormalizedChapter[]> {
    const source = this.getEnabledSource(sourceId);
    return source.getChapters(mangaId, options);
  }

  async getChapterPages(sourceId: string, chapterId: string, options?: ChapterPageOptions): Promise<NormalizedPage[]> {
    const source = this.getEnabledSource(sourceId);
    return source.getChapterPages(chapterId, options);
  }

  async getMangaLibrary(options?: MangaLibraryOptions): Promise<NormalizedMangaLibraryPage> {
    return this.getMangaDexSource().getMangaLibrary(options);
  }

  async getAggregatedMangaLibrary(options: MangaLibraryOptions = {}): Promise<AggregatedMangaLibraryPage> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const limit = Math.min(Math.max(options.limit ?? 15, 1), 100);
    const page = Math.max(options.page ?? 0, 0);
    const offset = page * limit;
    const requestedSource = options.source ?? 'all';
    const isSingleSourceRequest = requestedSource !== 'all';
    const sourceLimit = Math.min(Math.max((page + 1) * limit, limit * 4), 100);
    const hasMangaDexTagFilters = (options.tagIds?.length ?? 0) > 0;
    const librarySources = Array.from(this.sources.values()).filter((source) => {
      if (!source.enabled || typeof source.getMangaLibrary !== 'function') {
        return false;
      }

      if (requestedSource !== 'all' && source.id !== requestedSource) {
        return false;
      }

      return !hasMangaDexTagFilters || source.id === 'mangadex';
    });
    const errors: SourceErrorResult[] = [];

    if (librarySources.length === 0) {
      throw new SourceNotImplementedError('No enabled sources support manga library lists');
    }

    const settledResults = await Promise.all(
      librarySources.map(async (source) => {
        try {
          const sourceRequestLimit =
            isSingleSourceRequest || source.id !== 'comick' ? (isSingleSourceRequest ? limit : sourceLimit) : limit;
          const result = await source.getMangaLibrary?.({
            ...options,
            lang,
            limit: sourceRequestLimit,
            page: isSingleSourceRequest ? page : 0
          });

          return {
            source: source.id,
            mangas: result?.mangas ?? [],
            total: result?.total ?? 0
          };
        } catch (error) {
          errors.push({
            source: source.id,
            message: error instanceof Error ? error.message : 'Unknown source error'
          });

          return null;
        }
      })
    );
    const results = settledResults.filter(
      (result): result is { source: string; mangas: NormalizedManga[]; total: number } => result !== null
    );

    if (isSingleSourceRequest && results.length === 0 && errors.length > 0) {
      throw new AppError(errors[0].message, 502);
    }

    const mangas = isSingleSourceRequest
      ? results.flatMap((result) => result.mangas).slice(0, limit)
      : this.mergeLibraryResults(results).slice(offset, offset + limit);

    return {
      source: 'all',
      lang,
      mangas,
      results,
      errors,
      total: results.reduce((total, result) => total + result.total, 0),
      limit,
      offset
    };
  }

  async getMangaTags(options?: SourceOptions): Promise<NormalizedMangaTag[]> {
    return this.getMangaDexSource().getMangaTags(options?.lang);
  }

  private getEnabledSource(sourceId: string): MangaSource {
    const source = this.getSource(sourceId);

    if (!source.enabled) {
      throw new SourceNotImplementedError(`Source "${sourceId}" is disabled or not implemented yet`);
    }

    return source;
  }

  private getMangaDexSource(): MangaDexService {
    const source = this.getEnabledSource('mangadex');

    if (!(source instanceof MangaDexService)) {
      throw new SourceNotImplementedError('MangaDex library is not available');
    }

    return source;
  }

  private mergeLibraryResults(results: { source: string; mangas: NormalizedManga[] }[]) {
    const merged: NormalizedManga[] = [];
    const seenMangaKeys = new Set<string>();
    const maxSourceLength = Math.max(0, ...results.map((result) => result.mangas.length));

    for (let index = 0; index < maxSourceLength; index += 1) {
      results.forEach((result) => {
        const manga = result.mangas[index];

        if (!manga) {
          return;
        }

        const mangaKey = `${manga.source}:${manga.id}`;

        if (!seenMangaKeys.has(mangaKey)) {
          seenMangaKeys.add(mangaKey);
          merged.push(manga);
        }
      });
    }

    return merged;
  }
}

export const mangaAggregatorService = new MangaAggregatorService();
