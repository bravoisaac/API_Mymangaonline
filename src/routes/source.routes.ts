import { Router } from 'express';

import { listSources } from '../controllers/source.controller';

export const sourceRoutes = Router();

sourceRoutes.get('/', listSources);
