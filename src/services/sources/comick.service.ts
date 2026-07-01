import { AxiosError } from 'axios';

import { env } from '../../config/env';
import {
  ChapterOptions,
  ChapterPageOptions,
  NormalizedChapter,
  NormalizedManga,
  NormalizedMangaDetails,
  NormalizedPage,
  SearchOptions,
  SourceOptions
} from '../../types/manga.types';
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

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  async searchManga(query: string, options: SearchOptions = {}): Promise<NormalizedManga[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    try {
      const data = await this.requestSearch(query, options.limit ?? 20);
      const comics = resolveSearchComics(data);

      return comics.map((comic) => this.mapManga(comic, lang));
    } catch (error) {
      throw new ExternalApiError(getComickErrorMessage(error));
    }
  }

  async getMangaDetails(id: string, options: SourceOptions = {}): Promise<NormalizedMangaDetails> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;

    try {
      const response = await httpClient.get<string>(`${this.baseUrl}/comic/${id}`, {
        headers: getComickRequestHeaders(),
        responseType: 'text'
      });
      const comic = this.extractJsonFromHtml<ComickComic>(response.data, 'comic-data');
      const manga = this.mapManga(comic, lang);

      return {
        ...manga,
        authors: this.getAuthors(comic),
        artists: this.getAuthors(comic),
        chaptersCount: this.getChaptersCount(comic, undefined)
      };
    } catch (error) {
      throw new ExternalApiError(getComickErrorMessage(error));
    }
  }

  async getChapters(mangaId: string, options: ChapterOptions = {}): Promise<NormalizedChapter[]> {
    const lang = options.lang ?? env.mangadexDefaultLanguage;
    const limit = options.limit ?? 100;
    const page = Math.floor((options.offset ?? 0) / limit) + 1;

    try {
      const response = await httpClient.get<ComickChaptersResponse>(`${this.baseUrl}/api/comics/${mangaId}/chapter-list`, {
        headers: getComickRequestHeaders(),
        params: {
          lang,
          page
        }
      });

      return (response.data.data ?? response.data.chapters ?? [])
        .map((chapter) => this.mapChapter(chapter, mangaId, lang))
        .filter((chapter) => chapter.chapter);
    } catch (error) {
      throw new ExternalApiError(getComickErrorMessage(error));
    }
  }

  async getChapterPages(chapterId: string, _options?: ChapterPageOptions): Promise<NormalizedPage[]> {
    try {
      const response = await httpClient.get<string>(`${this.baseUrl}/comic/${chapterId}`, {
        headers: getComickRequestHeaders(),
        responseType: 'text'
      });
      const data = this.extractJsonFromHtml<ComickChapterPagesResponse>(response.data, 'sv-data');
      const images = data.chapter?.images ?? data.chapter?.md_images ?? data.images ?? data.md_images ?? [];

      return images
        .map((image, index) => this.mapPage(image, index))
        .filter((page): page is NormalizedPage => page !== null);
    } catch (error) {
      throw new ExternalApiError(getComickErrorMessage(error));
    }
  }

  private mapManga(comic: ComickComic, language: string): NormalizedManga {
    return {
      id: comic.slug ?? comic.hid ?? String(comic.id ?? ''),
      source: this.id,
      title: comic.title ?? comic.slug ?? '',
      alternativeTitles: uniqueStrings(comic.md_titles?.map((title) => title.title) ?? []),
      description: comic.desc ?? comic.description ?? '',
      cover: this.buildImageUrl(comic.cover_url ?? comic.default_thumbnail ?? comic.md_covers?.[0]?.b2key),
      status: normalizeComickStatus(comic.status),
      year: comic.year ?? null,
      genres: this.getGenres(comic),
      language,
      raw: comic
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
      comic.md_comic_md_genres?.map((genre) => genre.md_genres?.name ?? genre.md_genres?.slug) ?? []
    );
  }

  private getAuthors(comic: ComickComic) {
    return uniqueStrings(comic.md_comic_md_authors?.map((author) => author.md_authors?.name) ?? []);
  }

  private getChaptersCount(comic: ComickComic, chapters: ComickChapter[] | undefined) {
    if (typeof comic.chapters_count === 'number') {
      return comic.chapters_count;
    }

    if (typeof comic.last_chapter === 'number') {
      return comic.last_chapter;
    }

    return chapters?.length ?? 0;
  }

  private async requestSearch(query: string, limit: number): Promise<ComickSearchResponse> {
    const params = {
      q: query,
      limit,
      order_by: 'user_follow_count',
      order_direction: 'desc',
      showAll: 'false',
      exclude_mylist: 'false',
      type: 'comic'
    };

    try {
      const response = await httpClient.get<ComickSearchResponse>(`${this.baseUrl}/api/search`, {
        headers: getComickRequestHeaders(),
        params
      });

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && (error.response?.status === 403 || error.response?.status === 404)) {
        const fallbackBaseUrl = this.baseUrl === 'https://comick.art' ? 'https://comick.live' : 'https://comick.art';
        const response = await httpClient.get<ComickSearchResponse>(`${fallbackBaseUrl}/api/search`, {
          headers: getComickRequestHeaders(),
          params
        });

        return response.data;
      }

      throw error;
    }
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
