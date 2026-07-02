import { MangaSearchResult } from '../../types/provider.types';
import { WordpressMangaScraperProvider } from './wordpressMangaScraperProvider';

interface TuMangaOnlineSearchResponse {
  success?: boolean;
  data?: {
    items?: TuMangaOnlineSearchItem[];
  };
}

interface TuMangaOnlineSearchItem {
  title?: string;
  cover?: string;
  permalink?: string;
  genres?: string;
  subtitle?: string;
}

export class TuMangaOnlineProvider extends WordpressMangaScraperProvider {
  private searchNonce?: string;

  constructor(baseUrl: string, enabled: boolean) {
    super({
      id: 'tumangaonline',
      name: 'TuMangaOnline',
      baseUrl,
      enabled,
      language: 'es'
    });
  }

  override async search(query: string): Promise<MangaSearchResult[]> {
    const nonce = await this.getSearchNonce();

    if (!nonce) {
      return super.search(query);
    }

    const body = new URLSearchParams();
    body.append('action', 'manganexus_search_autocomplete');
    body.append('nonce', nonce);
    body.append('q', query);
    body.append('post_type', 'manga');

    const payload = await this.requestJson<TuMangaOnlineSearchResponse>('/wp-admin/admin-ajax.php', {
      method: 'POST',
      data: body.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!payload.success || !payload.data?.items?.length) {
      return super.search(query);
    }

    return payload.data.items
      .map((item): MangaSearchResult | undefined => {
        const mangaUrl = this.normalizeUrl(this.baseUrl, item.permalink);
        const title = this.normalizeText(item.title);

        if (!mangaUrl || !title) {
          return undefined;
        }

        return {
          id: this.encodeIdFromUrl(mangaUrl),
          providerId: this.id,
          title,
          ...(item.cover ? { cover: this.normalizeUrl(mangaUrl, item.cover) } : {}),
          ...(item.genres || item.subtitle ? { description: [item.subtitle, item.genres].filter(Boolean).join(' · ') } : {}),
          url: mangaUrl
        };
      })
      .filter((item): item is MangaSearchResult => Boolean(item));
  }

  private async getSearchNonce(): Promise<string | undefined> {
    if (this.searchNonce) {
      return this.searchNonce;
    }

    const html = await this.requestHtml(this.baseUrl);
    const $ = this.loadHtml(html);
    this.searchNonce = $('.mnx-search-wrap[data-nonce]').first().attr('data-nonce')?.trim();
    return this.searchNonce;
  }
}
