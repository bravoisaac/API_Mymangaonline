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

export interface MangaSource {
  id: string;
  name: string;
  enabled: boolean;
  supportsSpanish: boolean;
  supportsPages: boolean;

  searchManga(query: string, options?: SearchOptions): Promise<NormalizedManga[]>;
  getMangaLibrary?(options?: MangaLibraryOptions): Promise<NormalizedMangaLibraryPage>;
  getMangaDetails(id: string, options?: SourceOptions): Promise<NormalizedMangaDetails>;
  getChapters(mangaId: string, options?: ChapterOptions): Promise<NormalizedChapter[]>;
  getChapterPages(chapterId: string, options?: ChapterPageOptions): Promise<NormalizedPage[]>;
}
