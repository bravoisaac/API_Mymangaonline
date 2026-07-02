import { NextFunction, Request, Response } from 'express';

import { providerManager } from '../services/providerManager.service';

export function listProviders(request: Request, response: Response, next: NextFunction) {
  try {
    response.json({
      providers: providerManager.listProviders(request.query.all !== 'true')
    });
  } catch (error) {
    next(error);
  }
}
