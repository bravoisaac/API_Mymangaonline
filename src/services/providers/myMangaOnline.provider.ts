import { WordpressMangaScraperProvider } from './wordpressMangaScraperProvider';

export class MyMangaOnlineProvider extends WordpressMangaScraperProvider {
  constructor(baseUrl: string, enabled: boolean) {
    super({
      id: 'mymangaonline',
      name: 'MyMangaOnline',
      baseUrl,
      enabled,
      language: 'es'
    });
  }
}
