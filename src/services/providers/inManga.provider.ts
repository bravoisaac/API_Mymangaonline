import { MangaChapter, MangaDetails, MangaPage, MangaSearchResult } from '../../types/provider.types';
import { ExternalApiError, ValidationError } from '../../utils/errors';
import { BaseScraperProvider } from './baseScraperProvider';

interface InMangaSearchResultPayload {
  href?: string;
}

interface InMangaOuterChaptersResponse {
  data?: string | InMangaInnerChaptersResponse;
}

interface InMangaInnerChaptersResponse {
  success?: boolean;
  message?: string;
  result?: InMangaChapterPayload[];
}

interface InMangaChapterPayload {
  Number?: number;
  FriendlyChapterNumber?: string;
  FriendlyChapterNumberUrl?: string;
  Identification?: string;
  RegistrationDate?: string;
}

export class InMangaProvider extends BaseScraperProvider {
  constructor(baseUrl: string, enabled: boolean) {
    super('inmanga', 'InManga', baseUrl, enabled, 'es');
  }

  async search(query: string): Promise<MangaSearchResult[]> {
    const body = new URLSearchParams();
    body.append('filter[generes][0]', '-1');
    body.append('filter[queryString]', query);
    body.append('filter[skip]', '0');
    body.append('filter[take]', '20');
    body.append('filter[sortby]', '1');
    body.append('filter[broadcastStatus]', '0');
    body.append('filter[onlyFavorites]', 'false');
    body.append('d', '');

    const html = await this.requestHtml('/manga/getMangasConsultResult', {
      method: 'POST',
      data: body.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: this.normalizeUrl(this.baseUrl, '/manga/consult') ?? this.baseUrl
      }
    });
    const $ = this.loadHtml(html);

    return $('a.manga-result')
      .toArray()
      .map((element): MangaSearchResult | undefined => {
        const node = $(element);
        const href = node.attr('href');
        const mangaUrl = this.normalizeUrl(this.baseUrl, href);
        const title = this.normalizeText(node.find('h4').first().text()) ?? this.normalizeText(node.text());
        const cover = this.normalizeUrl(
          mangaUrl ?? this.baseUrl,
          node.find('img').first().attr('data-src') ?? node.find('img').first().attr('src')
        );
        const status = this.normalizeText(node.find('.label').last().text());

        if (!mangaUrl || !title) {
          return undefined;
        }

        return {
          id: this.encodeIdFromUrl(mangaUrl),
          providerId: this.id,
          title,
          ...(cover ? { cover } : {}),
          ...(status ? { description: status } : {}),
          url: mangaUrl
        };
      })
      .filter((item): item is MangaSearchResult => Boolean(item));
  }

  async getMangaDetails(mangaId: string): Promise<MangaDetails> {
    const mangaUrl = this.decodeIdToUrl(mangaId);
    const html = await this.requestHtml(mangaUrl);
    const $ = this.loadHtml(html);
    const title = this.safeText($, '.panel-heading h1') ?? this.safeText($, 'h1') ?? 'Manga sin título';
    const titlePanel = $('.panel-heading h1').first().closest('.panel');
    const description =
      this.normalizeText(titlePanel.find('.panel-body').first().text()) ??
      this.getMetaContent($, 'description') ??
      this.getMetaContent($, 'og:description');
    const cover =
      this.normalizeUrl(mangaUrl, this.safeAttr($, 'img[src*="intomanga"]', 'src')) ??
      this.normalizeUrl(mangaUrl, this.getMetaContent($, 'og:image'));

    return {
      id: mangaId,
      providerId: this.id,
      title,
      ...(cover ? { cover } : {}),
      ...(description ? { description } : {}),
      ...(this.extractDetailValue($, 'Autor') ? { author: this.extractDetailValue($, 'Autor') } : {}),
      ...(this.extractDetailValue($, 'Estado') ? { status: this.extractDetailValue($, 'Estado') } : {}),
      ...(this.extractGenres($).length ? { genres: this.extractGenres($) } : {}),
      url: mangaUrl
    };
  }

  async getChapters(mangaId: string): Promise<MangaChapter[]> {
    const mangaUrl = this.decodeIdToUrl(mangaId);
    const html = await this.requestHtml(mangaUrl);
    const $ = this.loadHtml(html);
    const mangaIdentification = $('#Identification').attr('value')?.trim() ?? this.extractUuidFromUrl(mangaUrl);

    if (!mangaIdentification) {
      throw new ExternalApiError('InManga manga identification not found');
    }

    const payload = await this.requestJson<InMangaOuterChaptersResponse>('/chapter/getall', {
      params: { mangaIdentification },
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: mangaUrl
      }
    });
    const innerPayload = this.parseChaptersPayload(payload);
    const chapterTemplate = this.extractChapterTemplate(html, mangaUrl);

    return innerPayload
      .map((chapter): MangaChapter | undefined => {
        const chapterIdentification = chapter.Identification?.trim();

        if (!chapterIdentification) {
          return undefined;
        }

        const chapterNumber = typeof chapter.Number === 'number' ? chapter.Number : undefined;
        const friendlyChapterNumber =
          chapter.FriendlyChapterNumberUrl?.trim() ??
          chapter.FriendlyChapterNumber?.trim() ??
          chapterNumber?.toString();
        const chapterUrl = this.buildChapterUrl(chapterTemplate, mangaUrl, friendlyChapterNumber, chapterIdentification);
        const title = `Capítulo ${chapter.FriendlyChapterNumber?.trim() ?? chapterNumber ?? ''}`.trim();

        return {
          id: this.encodeIdFromUrl(chapterUrl),
          providerId: this.id,
          mangaId,
          title,
          ...(chapterNumber !== undefined ? { chapterNumber } : {}),
          language: this.language,
          ...(chapter.RegistrationDate ? { publishedAt: new Date(chapter.RegistrationDate).toISOString() } : {}),
          url: chapterUrl
        };
      })
      .filter((chapter): chapter is MangaChapter => Boolean(chapter))
      .sort((left, right) => (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0));
  }

  async getChapterPages(chapterId: string): Promise<MangaPage[]> {
    const chapterUrl = this.decodeIdToUrl(chapterId);
    const html = await this.requestHtml(chapterUrl);
    const pageTemplate = this.extractScriptString(html, 'pu');
    const chapterIdentification = this.extractScriptString(html, 'cid') ?? this.extractUuidFromUrl(chapterUrl);

    if (!chapterIdentification) {
      throw new ExternalApiError('InManga chapter identification not found');
    }

    const controlsHtml = await this.requestHtml('/chapter/chapterIndexControls', {
      params: { identification: chapterIdentification },
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: chapterUrl
      }
    });
    const $controls = this.loadHtml(controlsHtml);
    const pages = this.extractInMangaPageIds($controls);

    if (pageTemplate && pages.length) {
      return pages.map((page, index) => ({
        index,
        imageUrl: this.normalizeUrl(
          chapterUrl,
          pageTemplate.replace(/identification/g, page.id).replace(/pageNumber/g, page.pageNumber)
        ) as string
      }));
    }

    const chapter$ = this.loadHtml(html);
    return this.extractImageUrls(chapter$, chapterUrl)
      .concat(this.extractImageUrls($controls, chapterUrl))
      .map((imageUrl, index) => ({
        index,
        imageUrl
      }));
  }

  private parseChaptersPayload(payload: InMangaOuterChaptersResponse): InMangaChapterPayload[] {
    const data = payload.data;
    const parsed =
      typeof data === 'string'
        ? (JSON.parse(data) as InMangaInnerChaptersResponse)
        : data ?? (payload as InMangaInnerChaptersResponse);

    if (!parsed.success && parsed.message && parsed.message !== 'OK') {
      throw new ExternalApiError(`InManga chapters request failed: ${parsed.message}`);
    }

    return parsed.result ?? [];
  }

  private extractChapterTemplate(html: string, mangaUrl: string): string {
    const template = this.extractScriptString(html, 'chapterUrl');

    if (template) {
      return template;
    }

    const parsedUrl = new URL(mangaUrl);
    const detailPath = parsedUrl.pathname.replace(/\/[^/]+\/?$/, '');
    return `${detailPath}/chapterNumber/identification`;
  }

  private buildChapterUrl(template: string, mangaUrl: string, chapterNumber: string | undefined, identification: string): string {
    const fallbackChapterNumber = chapterNumber ?? '1';
    const path = template
      .replace(/chapterNumber/g, encodeURIComponent(fallbackChapterNumber))
      .replace(/identification/g, encodeURIComponent(identification));
    const chapterUrl = this.normalizeUrl(mangaUrl, path);

    if (!chapterUrl) {
      throw new ValidationError('Invalid InManga chapter URL');
    }

    return chapterUrl;
  }

  private extractScriptString(html: string, variableName: string): string | undefined {
    const regex = new RegExp(`var\\s+${variableName}\\s*=\\s*['"]([^'"]+)['"]`, 'i');
    return html.match(regex)?.[1];
  }

  private extractUuidFromUrl(url: string): string | undefined {
    return url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  }

  private extractInMangaPageIds($: ReturnType<InMangaProvider['loadHtml']>): Array<{ id: string; pageNumber: string }> {
    const pages: Array<{ id: string; pageNumber: string }> = [];

    $('#PageList option')
      .toArray()
      .forEach((element, index) => {
        const option = $(element);
        const id = option.attr('value')?.trim();
        const pageNumber = this.normalizeText(option.text()) ?? String(index + 1);

        if (id) {
          pages.push({ id, pageNumber });
        }
      });

    if (pages.length) {
      return pages;
    }

    $('.ImageContainer[id]')
      .toArray()
      .forEach((element, index) => {
        const container = $(element);
        const id = container.attr('id')?.trim();
        const pageNumber = container.attr('data-pagenumber')?.trim() ?? String(index + 1);

        if (id) {
          pages.push({ id, pageNumber });
        }
      });

    return pages;
  }

  private extractDetailValue($: ReturnType<InMangaProvider['loadHtml']>, label: string): string | undefined {
    let value: string | undefined;

    $('.list-group-item')
      .toArray()
      .some((element) => {
        const item = $(element);
        const text = this.normalizeText(item.text()) ?? '';

        if (!text.toLowerCase().includes(label.toLowerCase())) {
          return false;
        }

        value = this.normalizeText(item.find('.label').last().text()) ?? this.normalizeText(text.replace(label, ''));
        return Boolean(value);
      });

    return value;
  }

  private extractGenres($: ReturnType<InMangaProvider['loadHtml']>): string[] {
    return $('a[href*="genero"], a[href*="genre"], .genre, .genres a')
      .toArray()
      .map((element) => this.normalizeText($(element).text()))
      .filter((genre): genre is string => Boolean(genre));
  }
}
