import { Router } from 'express';

import { proxyImage } from '../controllers/proxy.controller';

export const proxyRoutes = Router();

proxyRoutes.get('/image', proxyImage);
