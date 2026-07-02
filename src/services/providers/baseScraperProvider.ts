import { AxiosError, AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import {
  ManagedMangaProvider,
  MangaChapter,
  MangaDetails,
  MangaPage,
  MangaSearchResult
} from '../../types/provider.types';
import { ExternalApiError, SourceUnavailableError, ValidationError } from '../../utils/errors';
import { httpClient } from '../../utils/httpClient';

const SCRAPER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 API_Mymangaonline/1.0';

const IMAGE_ATTRIBUTES = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-cfsrc'] as const;

export abstract class BaseScraperProvider implements ManagedMangaProvider {
  public readonly type = 'scraper' as const;
  public available = true;
  public unavailableReason?: string;

  protected constructor(
    public readonly id: string,
    public readonly name: string,
    protected readonly baseUrl: string,
    public readonly enabled: boolean,
    public readonly language = 'es'
  ) {}

  abstract search(query: string): Promise<MangaSearchResult[]>;
  abstract getMangaDetails(mangaId: string): Promise<MangaDetails>;
  abstract getChapters(mangaId: string): Promise<MangaChapter[]>;
  abstract getChapterPages(chapterId: string): Promise<MangaPage[]>;

  protected async requestHtml(url: string, config: AxiosRequestConfig = {}): Promise<string> {
    const normalizedUrl = this.normalizeUrl(this.baseUrl, url);

    if (!normalizedUrl) {
      throw new ValidationError('Invalid scraper URL');
    }

    try {
      const response = await httpClient.request<string>({
        method: 'GET',
        ...config,
        url: normalizedUrl,
        responseType: 'text',
        transformResponse: [(data) => data],
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: this.baseUrl,
          'User-Agent': SCRAPER_USER_AGENT,
          ...config.headers
        }
      });
      const html = typeof response.data === 'string' ? response.data : String(response.data);
      const $ = cheerio.load(html);
      const unavailableReason = this.detectUnavailable($, html, response.status);

      if (unavailableReason) {
        this.markUnavailable(unavailableReason);
        throw new SourceUnavailableError(this.id, unavailableReason);
      }

      this.markAvailable();
      return html;
    } catch (error) {
      if (error instanceof SourceUnavailableError) {
        throw error;
      }

      const reason = this.describeRequestError(error);
      this.markUnavailable(reason);
      throw new ExternalApiError(`Provider "${this.id}" request failed: ${reason}`);
    }
  }

  protected async requestJson<T>(url: string, config: AxiosRequestConfig = {}): Promise<T> {
    const normalizedUrl = this.normalizeUrl(this.baseUrl, url);

    if (!normalizedUrl) {
      throw new ValidationError('Invalid scraper URL');
    }

    try {
      const response = await httpClient.request<T>({
        method: 'GET',
        ...config,
        url: normalizedUrl,
        responseType: 'json',
        headers: {
          Accept: 'application/json, text/javascript, */*;q=0.1',
          Referer: this.baseUrl,
          'User-Agent': SCRAPER_USER_AGENT,
          ...config.headers
        }
      });

      this.markAvailable();
      return response.data;
    } catch (error) {
      const reason = this.describeRequestError(error);
      this.markUnavailable(reason);
      throw new ExternalApiError(`Provider "${this.id}" request failed: ${reason}`);
    }
  }

  protected loadHtml(html: string): CheerioAPI {
    return cheerio.load(html);
  }

  protected normalizeUrl(baseUrl: string, path?: string | null): string | undefined {
    const cleanPath = path?.trim();

    if (!cleanPath || cleanPath.startsWith('data:') || cleanPath.startsWith('blob:')) {
      return undefined;
    }

    try {
      if (cleanPath.startsWith('//')) {
        return `https:${cleanPath}`;
      }

      return new URL(cleanPath, baseUrl).toString();
    } catch {
      return undefined;
    }
  }

  protected safeText($: CheerioAPI, selector: string): string | undefined {
    return this.normalizeText($(selector).first().text());
  }

  protected safeAttr($: CheerioAPI, selector: string, attr: string): string | undefined {
    return $(selector).first().attr(attr)?.trim() || undefined;
  }

  protected parseChapterNumber(text: string): number | undefined {
    const normalized = this.normalizeText(text)?.replace(',', '.') ?? '';
    const chapterMatch = normalized.match(/(?:cap(?:i|í)tulo|cap\.?|chapter|ch\.?)\s*#?\s*(\d+(?:\.\d+)?)/i);
    const fallbackMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const rawNumber = chapterMatch?.[1] ?? fallbackMatch?.[1];

    if (!rawNumber) {
      return undefined;
    }

    const chapterNumber = Number(rawNumber);
    return Number.isFinite(chapterNumber) ? chapterNumber : undefined;
  }

  protected encodeIdFromUrl(url: string): string {
    const normalizedUrl = this.normalizeUrl(this.baseUrl, url);

    if (!normalizedUrl) {
      throw new ValidationError('Invalid URL to encode as scraper id');
    }

    return Buffer.from(normalizedUrl, 'utf8').toString('base64url');
  }

  protected decodeIdToUrl(id: string): string {
    try {
      const url = Buffer.from(id, 'base64url').toString('utf8');
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Unsupported URL protocol');
      }

      return parsedUrl.toString();
    } catch {
      throw new ValidationError('Invalid manga/chapter id');
    }
  }

  protected extractImageUrls($: CheerioAPI, baseUrl: string, selector = 'img'): string[] {
    const urls = new Set<string>();

    $(selector)
      .toArray()
      .forEach((element) => {
        const image = $(element);
        const rawUrl = this.getImageCandidate(image);
        const normalizedUrl = this.normalizeUrl(baseUrl, rawUrl);

        if (normalizedUrl && this.isLikelyContentImage(normalizedUrl)) {
          urls.add(normalizedUrl);
        }
      });

    return Array.from(urls);
  }

  protected getMetaContent($: CheerioAPI, property: string): string | undefined {
    return (
      $(`meta[property="${property}"]`).attr('content')?.trim() ||
      $(`meta[name="${property}"]`).attr('content')?.trim() ||
      undefined
    );
  }

  protected normalizeText(text?: string | null): string | undefined {
    const normalized = text?.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
  }

  protected parseDateToIso(text?: string): string | undefined {
    const normalized = this.normalizeText(text);

    if (!normalized) {
      return undefined;
    }

    const slashDate = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);

    if (slashDate) {
      const day = Number(slashDate[1]);
      const month = Number(slashDate[2]);
      const year = Number(slashDate[3]);

      if (day > 0 && month > 0 && month <= 12) {
        return new Date(Date.UTC(year, month - 1, day)).toISOString();
      }
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  protected cleanTitle(title: string): string {
    return title
      .replace(/^➤\s*/u, '')
      .replace(/\s*\|\s*LectorTmo$/i, '')
      .replace(/^Leer\s+manga\s+/i, '')
      .replace(/\s+Online$/i, '')
      .trim();
  }

  protected markUnavailable(reason: string): void {
    this.available = false;
    this.unavailableReason = reason;
  }

  protected markAvailable(): void {
    this.available = true;
    this.unavailableReason = undefined;
  }

  private getImageCandidate(image: Cheerio<AnyNode>): string | undefined {
    for (const attr of IMAGE_ATTRIBUTES) {
      const value = image.attr(attr);

      if (value) {
        return value;
      }
    }

    const srcset = image.attr('srcset') ?? image.attr('data-srcset');

    if (!srcset) {
      return undefined;
    }

    return srcset
      .split(',')
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .find(Boolean);
  }

  private detectUnavailable($: CheerioAPI, html: string, status: number): string | undefined {
    if (status === 401) {
      return 'login required';
    }

    if (status === 403) {
      return 'forbidden or blocked by provider';
    }

    if (status === 429) {
      return 'rate limited by provider';
    }

    const title = this.normalizeText($('title').text())?.toLowerCase() ?? '';
    const snippet = html.slice(0, 50000).toLowerCase();

    if (title.includes('just a moment') || title.includes('attention required')) {
      return 'cloudflare challenge';
    }

    if (snippet.includes('cf-browser-verification') || snippet.includes('cf_chl_') || snippet.includes('challenge-form')) {
      return 'cloudflare challenge';
    }

    if (title.includes('captcha') || snippet.includes('g-recaptcha-response')) {
      return 'captcha challenge';
    }

    return undefined;
  }

  private describeRequestError(error: unknown): string {
    if (error instanceof AxiosError) {
      if (error.response?.status) {
        return `HTTP ${error.response.status}`;
      }

      if (error.code) {
        return error.code;
      }

      return error.message;
    }

    return error instanceof Error ? error.message : 'unknown request error';
  }

  private isLikelyContentImage(url: string): boolean {
    const lowered = url.toLowerCase();

    if (!/\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lowered)) {
      return false;
    }

    return ![
      'logo',
      'favicon',
      'avatar',
      'emoji',
      'placeholder',
      'poster-fallback',
      'wp-includes',
      '/assets/img/'
    ].some((token) => lowered.includes(token));
  }
}
