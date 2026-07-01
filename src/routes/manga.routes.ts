import { Router } from 'express';

import {
  getChapterPages,
  getMangaChapters,
  getMangaDetails,
  searchAllManga,
  searchManga
} from '../controllers/manga.controller';

export const mangaRoutes = Router();

mangaRoutes.get('/search/all', searchAllManga);
mangaRoutes.get('/search', searchManga);
mangaRoutes.get('/:source/:id/chapters', getMangaChapters);
mangaRoutes.get('/:source/chapter/:chapterId/pages', getChapterPages);
mangaRoutes.get('/:source/:id', getMangaDetails);
