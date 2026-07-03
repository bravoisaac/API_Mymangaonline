import { env } from '../config/env';
import {
  MangaChapter,
  MangaDetails,
  MangaPage,
  MangaSearchResult,
  ManagedMangaProvider,
  ProviderErrorResult,
  ProviderMetadata,
  ProviderSearchResult
} from '../types/provider.types';
import { SourceNotFoundError, SourceNotImplementedError } from '../utils/errors';
import { InMangaProvider } from './providers/inManga.provider';
import { LeerMangaProvider } from './providers/leerManga.provider';
import { MyMangaOnlineProvider } from './providers/myMangaOnline.provider';
import { TuMangaOnlineProvider } from './providers/tuMangaOnline.provider';
import { createCacheKey, TtlCache } from '../utils/cache';

export class ProviderManager {
  private readonly providers: Map<string, ManagedMangaProvider>;
  private readonly cache = new TtlCache<unknown>(env.queryCacheTtlMs, env.queryCacheMaxEntries);

  constructor() {
    const providerList: ManagedMangaProvider[] = [
      new MyMangaOnlineProvider(env.myMangaOnlineBaseUrl, env.providers.myMangaOnline),
      new InMangaProvider(env.inmangaBaseUrl, env.providers.inmanga),
      new TuMangaOnlineProvider(env.tuMangaOnlineBaseUrl, env.providers.tuMangaOnline),
      new LeerMangaProvider(env.leerMangaBaseUrl, env.providers.leerManga)
    ];

    this.providers = new Map(providerList.map((provider) => [provider.id, provider]));
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  listProviders(activeOnly = true): ProviderMetadata[] {
    return Array.from(this.providers.values())
      .filter((provider) => !activeOnly || provider.enabled)
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        language: provider.language,
        type: provider.type,
        enabled: provider.enabled,
        available: provider.available,
        ...(provider.unavailableReason ? { unavailableReason: provider.unavailableReason } : {})
      }));
  }

  async searchProvider(providerId: string, query: string): Promise<MangaSearchResult[]> {
    const provider = this.getEnabledProvider(providerId);
    return this.cached(['searchProvider', providerId, query.trim().toLowerCase()], () => provider.search(query));
  }

  async searchAll(query: string): Promise<{
    query: string;
    results: ProviderSearchResult[];
    errors: ProviderErrorResult[];
  }> {
    const cacheKey = createCacheKey('providerManager', 'searchAll', query.trim().toLowerCase());
    const cachedResult = this.cache.get(cacheKey) as
      | {
          query: string;
          results: ProviderSearchResult[];
          errors: ProviderErrorResult[];
        }
      | undefined;

    if (cachedResult) {
      return cachedResult;
    }

    const providers = Array.from(this.providers.values()).filter((provider) => provider.enabled && provider.available);
    const results: ProviderSearchResult[] = [];
    const errors: ProviderErrorResult[] = [];

    for (const [index, provider] of providers.entries()) {
      if (index > 0) {
        await this.delay(env.scraperRequestDelayMs);
      }

      try {
        const items = await this.searchProvider(provider.id, query);
        results.push({ providerId: provider.id, items });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown provider error';
        console.warn(`[ProviderManager] provider search failed: ${provider.id}`, { providerId: provider.id, message });
        errors.push({ providerId: provider.id, message });
      }
    }

    const payload = {
      query,
      results,
      errors
    };

    if (errors.length === 0) {
      this.cache.set(cacheKey, payload);
    }

    return payload;
  }

  async getMangaDetails(providerId: string, mangaId: string): Promise<MangaDetails> {
    const provider = this.getEnabledProvider(providerId);
    return this.cached(['getMangaDetails', providerId, mangaId], () => provider.getMangaDetails(mangaId));
  }

  async getChapters(providerId: string, mangaId: string): Promise<MangaChapter[]> {
    const provider = this.getEnabledProvider(providerId);
    return this.cached(['getChapters', providerId, mangaId], () => provider.getChapters(mangaId));
  }

  async getChapterPages(providerId: string, chapterId: string): Promise<MangaPage[]> {
    const provider = this.getEnabledProvider(providerId);
    return this.cached(['getChapterPages', providerId, chapterId], () => provider.getChapterPages(chapterId));
  }

  private getProvider(providerId: string): ManagedMangaProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new SourceNotFoundError(providerId);
    }

    return provider;
  }

  private getEnabledProvider(providerId: string): ManagedMangaProvider {
    const provider = this.getProvider(providerId);

    if (!provider.enabled || !provider.available) {
      throw new SourceNotImplementedError(`Provider "${providerId}" is disabled or unavailable`);
    }

    return provider;
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private cached<TValue>(parts: unknown[], loader: () => Promise<TValue>): Promise<TValue> {
    return this.cache.getOrSet(createCacheKey('providerManager', ...parts), loader) as Promise<TValue>;
  }
}

export const providerManager = new ProviderManager();
