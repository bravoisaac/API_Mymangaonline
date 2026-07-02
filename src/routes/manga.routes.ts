import { Router } from 'express';

import {
  getChapterPages,
  getMangaLibrary,
  getMangaChapters,
  getMangaDetails,
  getMangaTags,
  searchAllManga,
  searchManga,
  searchProviderManga
} from '../controllers/manga.controller';

export const mangaRoutes = Router();

mangaRoutes.get('/search/all', searchAllManga);
mangaRoutes.get('/search/:providerId', searchProviderManga);
mangaRoutes.get('/search', searchManga);
mangaRoutes.get('/library', getMangaLibrary);
mangaRoutes.get('/tags', getMangaTags);
mangaRoutes.get('/:source/:id/chapters', getMangaChapters);
mangaRoutes.get('/:providerId/chapters/:chapterId/pages', getChapterPages);
mangaRoutes.get('/:source/chapter/:chapterId/pages', getChapterPages);
mangaRoutes.get('/:source/:id', getMangaDetails);
