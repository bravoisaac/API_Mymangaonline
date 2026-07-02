import { Router } from 'express';

import { listProviders } from '../controllers/provider.controller';

export const providerRoutes = Router();

providerRoutes.get('/', listProviders);
