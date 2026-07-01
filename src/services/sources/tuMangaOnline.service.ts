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
import { SourceNotImplementedError } from '../../utils/errors';
import { MangaSource } from './mangaSource.interface';

export class TuMangaOnlineService implements MangaSource {
  public readonly id = 'tumangaonline';
  public readonly name = 'TuMangaOnline';
  public readonly enabled: boolean;
  public readonly supportsSpanish = true;
  public readonly supportsPages = true;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  async searchManga(_query: string, _options?: SearchOptions): Promise<NormalizedManga[]> {
    throw new SourceNotImplementedError();
  }

  async getMangaDetails(_id: string, _options?: SourceOptions): Promise<NormalizedMangaDetails> {
    throw new SourceNotImplementedError();
  }

  async getChapters(_mangaId: string, _options?: ChapterOptions): Promise<NormalizedChapter[]> {
    throw new SourceNotImplementedError();
  }

  async getChapterPages(_chapterId: string, _options?: ChapterPageOptions): Promise<NormalizedPage[]> {
    throw new SourceNotImplementedError();
  }
}
