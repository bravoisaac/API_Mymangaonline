import type { CheerioAPI } from 'cheerio';

import { MangaChapter, MangaDetails, MangaPage, MangaSearchResult } from '../../types/provider.types';
import { BaseScraperProvider } from './baseScraperProvider';

interface WordpressMangaScraperOptions {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  language?: string;
}

export class WordpressMangaScraperProvider extends BaseScraperProvider {
  constructor(options: WordpressMangaScraperOptions) {
    super(options.id, options.name, options.baseUrl, options.enabled, options.language ?? 'es');
  }

  async search(query: string): Promise<MangaSearchResult[]> {
    const searchUrl = this.buildSearchUrl(query);
    const html = await this.requestHtml(searchUrl);
    const $ = this.loadHtml(html);

    return this.extractSearchResults($, searchUrl).slice(0, 20);
  }

  async getMangaDetails(mangaId: string): Promise<MangaDetails> {
    const url = this.decodeIdToUrl(mangaId);
    const html = await this.requestHtml(url);
    const $ = this.loadHtml(html);
    const metaTitle = this.getMetaContent($, 'og:title') ?? this.safeText($, 'title');
    const title =
      this.safeText($, 'main h1') ??
      this.safeText($, 'h1') ??
      this.cleanTitle(metaTitle ?? 'Manga sin título');
    const description =
      this.safeText($, '[data-syn-full]') ??
      this.safeText($, '[data-syn-short]') ??
      this.safeText($, '.description, .summary__content, .manga-excerpt, .entry-content p') ??
      this.getMetaContent($, 'og:description') ??
      this.getMetaContent($, 'description');
    const cover =
      this.normalizeUrl(url, this.getMetaContent($, 'og:image')) ??
      this.normalizeUrl(
        url,
        this.safeAttr($, 'main img[alt], .summary_image img, .manga-cover-wrap img, img.wp-post-image', 'src')
      );

    return {
      id: mangaId,
      providerId: this.id,
      title: this.cleanTitle(title),
      ...(cover ? { cover } : {}),
      ...(description ? { description } : {}),
      ...(this.extractAuthor($) ? { author: this.extractAuthor($) } : {}),
      ...(this.extractStatus($) ? { status: this.extractStatus($) } : {}),
      ...(this.extractGenres($).length ? { genres: this.extractGenres($) } : {}),
      url
    };
  }

  async getChapters(mangaId: string): Promise<MangaChapter[]> {
    const mangaUrl = this.decodeIdToUrl(mangaId);
    const html = await this.requestHtml(mangaUrl);
    const $ = this.loadHtml(html);
    const chapters = this.extractChapters($, mangaUrl, mangaId);

    return chapters.sort((left, right) => (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0));
  }

  async getChapterPages(chapterId: string): Promise<MangaPage[]> {
    const chapterUrl = this.decodeIdToUrl(chapterId);
    const html = await this.requestHtml(chapterUrl);
    const $ = this.loadHtml(html);
    const allPages = this.extractAllPagesArray(html);
    const urls = allPages.length
      ? allPages
      : this.extractImageUrls(
          $,
          chapterUrl,
          '#mn-pages img, .mn-pages-strip img, .reading-content img, .chapter-content img, .entry-content img, main img, img.wp-manga-chapter-img'
        );

    return urls.map((imageUrl, index) => ({
      index,
      imageUrl
    }));
  }

  protected buildSearchUrl(query: string): string {
    const url = new URL('/', this.baseUrl);
    url.searchParams.set('s', query);
    url.searchParams.set('post_type', 'manga');
    return url.toString();
  }

  protected extractSearchResults($: CheerioAPI, pageUrl: string): MangaSearchResult[] {
    const results = new Map<string, MangaSearchResult>();
    const selectors = [
      '.manga-card-wrapper',
      '.page-item-detail',
      '.c-tabs-item__content',
      'article',
      '.post',
      'a[href*="/manga/"]'
    ];

    selectors.forEach((selector) => {
      $(selector)
        .toArray()
        .forEach((element) => {
          const node = $(element);
          const link = node.is('a') ? node : node.find('a[href*="/manga/"]').first();
          const href = link.attr('href');
          const mangaUrl = this.normalizeUrl(pageUrl, href);

          if (!mangaUrl || !this.isMangaDetailUrl(mangaUrl) || results.has(mangaUrl)) {
            return;
          }

          const title =
            this.normalizeText(
              link.find('h1,h2,h3,.manga-title,.post-title,.entry-title,.title').first().text()
            ) ??
            this.normalizeText(node.find('h1,h2,h3,.manga-title,.post-title,.entry-title,.title').first().text()) ??
            this.normalizeText(link.attr('title')) ??
            this.normalizeText(link.text());

          if (!title || title.length < 2) {
            return;
          }

          const cover =
            this.extractCssBackgroundImage(node.attr('style')) ??
            this.extractCssBackgroundImage(node.find('[style*="background"]').first().attr('style')) ??
            this.normalizeUrl(
              mangaUrl,
              node.find('img').first().attr('data-src') ??
                node.find('img').first().attr('data-lazy-src') ??
                node.find('img').first().attr('data-original') ??
                node.find('img').first().attr('src')
            );
          const description = this.normalizeText(
            node.find('.summary,.description,.excerpt,.entry-summary,.manga-excerpt').first().text()
          );

          results.set(mangaUrl, {
            id: this.encodeIdFromUrl(mangaUrl),
            providerId: this.id,
            title: this.cleanTitle(title),
            ...(cover ? { cover } : {}),
            ...(description ? { description } : {}),
            url: mangaUrl
          });
        });
    });

    return Array.from(results.values());
  }

  protected extractChapters($: CheerioAPI, mangaUrl: string, mangaId: string): MangaChapter[] {
    const chapters = new Map<string, MangaChapter>();
    const selector = [
      '#mn-chapters-list a.chapter-card',
      'a.chapter-card[href*="/manga-chapter/"]',
      '.wp-manga-chapter a',
      '.chapter-list a',
      '.chapters a',
      '.listing-chapters_wrap a',
      'a[href*="/manga-chapter/"]',
      'a[href*="/chapter/"]'
    ].join(',');

    $(selector)
      .toArray()
      .forEach((element) => {
        const link = $(element);
        const href = link.attr('href');
        const chapterUrl = this.normalizeUrl(mangaUrl, href);

        if (!chapterUrl || chapters.has(chapterUrl) || !this.isChapterUrl(chapterUrl)) {
          return;
        }

        const title =
          this.normalizeText(link.find('.font-bold,.chapter-title,.chapternum,.chapter-name').first().text()) ??
          this.normalizeText(link.attr('title')) ??
          this.normalizeText(link.text()) ??
          'Capítulo';
        const chapterNumber = this.parseChapterNumber(`${title} ${chapterUrl}`);
        const dateText = this.normalizeText(link.text())?.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0];
        const publishedAt = this.parseDateToIso(dateText);

        chapters.set(chapterUrl, {
          id: this.encodeIdFromUrl(chapterUrl),
          providerId: this.id,
          mangaId,
          title,
          ...(chapterNumber !== undefined ? { chapterNumber } : {}),
          language: this.language,
          ...(publishedAt ? { publishedAt } : {}),
          url: chapterUrl
        });
      });

    return Array.from(chapters.values());
  }

  protected extractAllPagesArray(html: string): string[] {
    const match = html.match(/ALL_PAGES\s*=\s*(\[[\s\S]*?\])\s*;/);

    if (!match) {
      return [];
    }

    try {
      const pages = JSON.parse(match[1]) as unknown;

      if (!Array.isArray(pages)) {
        return [];
      }

      return pages.filter((page): page is string => typeof page === 'string');
    } catch {
      return [];
    }
  }

  private extractAuthor($: CheerioAPI): string | undefined {
    return this.extractLabelValue($, ['autor', 'author']);
  }

  private extractStatus($: CheerioAPI): string | undefined {
    return (
      this.extractLabelValue($, ['estado', 'status']) ??
      this.normalizeText(
        $('span,div')
          .filter((_index, element) => /en emisi|finaliz|ongoing|completed/i.test($(element).text()))
          .first()
          .text()
      )
    );
  }

  private extractGenres($: CheerioAPI): string[] {
    const genres = new Set<string>();
    const selector = [
      'a[href*="/genre/"]',
      'a[href*="/genres/"]',
      'a[href*="/genero/"]',
      'a[href*="/manga-genre/"]',
      '.genres a',
      '.manga-genres a',
      '.post-content_item a'
    ].join(',');

    $(selector)
      .toArray()
      .forEach((element) => {
        const text = this.normalizeText($(element).text());

        if (text && text.length <= 40) {
          genres.add(text);
        }
      });

    return Array.from(genres);
  }

  private extractLabelValue($: CheerioAPI, labels: string[]): string | undefined {
    let value: string | undefined;

    $('div,li,p,span')
      .toArray()
      .some((element) => {
        const text = this.normalizeText($(element).text()) ?? '';
        const lowered = text.toLowerCase();
        const label = labels.find((candidate) => lowered.startsWith(candidate) || lowered.includes(`${candidate}:`));

        if (!label) {
          return false;
        }

        value = this.normalizeText(text.replace(new RegExp(`${label}\\s*:?`, 'i'), ''));
        return Boolean(value);
      });

    return value;
  }

  private extractCssBackgroundImage(style?: string): string | undefined {
    const match = style?.match(/url\((['"]?)(.*?)\1\)/i);
    const rawUrl = match?.[2];
    return this.normalizeUrl(this.baseUrl, rawUrl);
  }

  private isMangaDetailUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.toLowerCase();
      return path.includes('/manga/') && !path.includes('/manga-chapter/') && path !== '/manga/' && path !== '/manga';
    } catch {
      return false;
    }
  }

  private isChapterUrl(url: string): boolean {
    try {
      const path = new URL(url).pathname.toLowerCase();
      return path.includes('/manga-chapter/') || path.includes('/chapter/');
    } catch {
      return false;
    }
  }
}
