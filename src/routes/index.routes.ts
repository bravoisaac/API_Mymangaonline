import { Router } from 'express';

import { mangaRoutes } from './manga.routes';
import { proxyRoutes } from './proxy.routes';
import { sourceRoutes } from './source.routes';

export const indexRoutes = Router();

indexRoutes.get('/health', (_request, response) => {
  response.json({
    ok: true,
    name: 'API_Mymangaonline',
    version: '1.0.0'
  });
});

indexRoutes.use('/sources', sourceRoutes);
indexRoutes.use('/manga', mangaRoutes);
indexRoutes.use('/proxy', proxyRoutes);
