import { WordpressMangaScraperProvider } from './wordpressMangaScraperProvider';

export class LeerMangaProvider extends WordpressMangaScraperProvider {
  constructor(baseUrl: string, enabled: boolean) {
    super({
      id: 'leermanga',
      name: 'LeerManga',
      baseUrl,
      enabled,
      language: 'es'
    });
  }
}
