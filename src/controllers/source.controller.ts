import { Request, Response } from 'express';

import { mangaAggregatorService } from '../services/mangaAggregator.service';

export function listSources(_request: Request, response: Response) {
  response.json({
    sources: mangaAggregatorService.listSources()
  });
}
