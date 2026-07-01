import {
  ChapterOptions,
  ChapterPageOptions,
  NormalizedChapter,
  NormalizedManga,
  NormalizedMangaDetails,
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

  private getEnabledSource(sourceId: string): MangaSource {
    const source = this.getSource(sourceId);

    if (!source.enabled) {
      throw new SourceNotImplementedError(`Source "${sourceId}" is disabled or not implemented yet`);
    }

    return source;
  }
}

export const mangaAggregatorService = new MangaAggregatorService();
