export interface MangaProvider {
  id: string;
  name: string;
  language?: string;
  type: 'api' | 'scraper';

  search(query: string): Promise<MangaSearchResult[]>;
  getMangaDetails(mangaId: string): Promise<MangaDetails>;
  getChapters(mangaId: string): Promise<MangaChapter[]>;
  getChapterPages(chapterId: string): Promise<MangaPage[]>;
}

export interface MangaSearchResult {
  id: string;
  providerId: string;
  title: string;
  cover?: string;
  description?: string;
  url?: string;
}

export interface MangaDetails {
  id: string;
  providerId: string;
  title: string;
  cover?: string;
  description?: string;
  author?: string;
  status?: string;
  genres?: string[];
  url?: string;
}

export interface MangaChapter {
  id: string;
  providerId: string;
  mangaId: string;
  title: string;
  chapterNumber?: number;
  volume?: string;
  language?: string;
  publishedAt?: string;
  url?: string;
}

export interface MangaPage {
  index: number;
  imageUrl: string;
}

export interface ManagedMangaProvider extends MangaProvider {
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  language?: string;
  type: 'api' | 'scraper';
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
}

export interface ProviderErrorResult {
  providerId: string;
  message: string;
}

export interface ProviderSearchResult {
  providerId: string;
  items: MangaSearchResult[];
}
