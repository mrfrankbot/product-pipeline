import { Request, Response, NextFunction } from 'express';
/**
 * Simple API key authentication middleware
 * Checks for X-API-Key header or api_key query parameter
 */
export declare const apiKeyAuth: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const rateLimit: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
