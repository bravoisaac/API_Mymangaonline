import { AxiosError } from 'axios';

import { env } from '../../config/env';
import {
  ChapterOptions,
  ChapterPageOptions,
  ChapterQuality,
  NormalizedChapter,
  NormalizedManga,
  NormalizedMangaDetails,
  NormalizedPage,
  SearchOptions,
  SourceOptions
} from '../../types/manga.types';
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
    return status ? `MangaDex request failed with status ${status}` : 'MangaDex request failed';
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

  async searchManga(query: string, options: SearchOptions = {}): Promise<NormalizedManga[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    try {
      const response = await httpClient.get<MangaDexCollection<MangaAttributes>>(`${this.baseUrl}/manga`, {
        params: {
          title: query,
          limit: options.limit ?? 20,
          'includes[]': ['cover_art'],
          'availableTranslatedLanguage[]': [lang],
          'contentRating[]': ['safe', 'suggestive'],
          hasAvailableChapters: true,
          'order[relevance]': 'desc'
        }
      });

      return response.data.data.map((entity) => this.mapManga(entity, lang));
    } catch (error) {
      throw new ExternalApiError(getMangaDexErrorMessage(error));
    }
  }

  async getMangaDetails(id: string, options: SourceOptions = {}): Promise<NormalizedMangaDetails> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    try {
      const response = await httpClient.get<MangaDexSingle<MangaAttributes>>(`${this.baseUrl}/manga/${id}`, {
        params: {
          'includes[]': ['cover_art', 'author', 'artist']
        }
      });

      const chaptersCount = await this.getChapterCount(id, lang);
      const manga = this.mapManga(response.data.data, lang);

      return {
        ...manga,
        authors: getRelationshipNames(response.data.data, 'author'),
        artists: getRelationshipNames(response.data.data, 'artist'),
        chaptersCount
      };
    } catch (error) {
      throw new ExternalApiError(getMangaDexErrorMessage(error));
    }
  }

  async getChapters(mangaId: string, options: ChapterOptions = {}): Promise<NormalizedChapter[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    try {
      const response = await httpClient.get<MangaDexCollection<ChapterAttributes>>(
        `${this.baseUrl}/manga/${mangaId}/feed`,
        {
          params: {
            limit: options.limit ?? 100,
            offset: options.offset ?? 0,
            'translatedLanguage[]': [lang],
            'order[chapter]': 'asc'
          }
        }
      );

      return response.data.data
        .map((entity) => this.mapChapter(entity, mangaId, lang))
        .filter((chapter) => chapter.pages > 0);
    } catch (error) {
      throw new ExternalApiError(getMangaDexErrorMessage(error));
    }
  }

  async getChapterPages(chapterId: string, options: ChapterPageOptions = {}): Promise<NormalizedPage[]> {
    const quality = options.quality ?? env.defaultChapterQuality;

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
    const response = await httpClient.get<MangaDexCollection<ChapterAttributes>>(`${this.baseUrl}/manga/${mangaId}/feed`, {
      params: {
        limit: 1,
        offset: 0,
        'translatedLanguage[]': [language]
      }
    });

    return response.data.total ?? response.data.data.length;
  }
}
