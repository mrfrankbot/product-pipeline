import { info, warn } from '../utils/logger.js';
import { LocalPhotoRoomService } from './local-photoroom.js';
import { PhotoRoomService } from './photoroom.js';
import type { ProcessImageOptions } from './photoroom.js';

export type ImageServiceProvider = 'self-hosted' | 'photoroom' | 'auto';

export interface ImageService {
  removeBackground(imageUrl: string): Promise<Buffer>;
  processProductImage(imageUrl: string, options?: ProcessImageOptions): Promise<Buffer>;
  processWithParams(
    imageUrl: string,
    params: { background?: string; padding?: number; shadow?: boolean },
  ): Promise<{ buffer: Buffer; dataUrl: string }>;
  processAllImages(imageUrls: string[], options?: ProcessImageOptions): Promise<Buffer[]>;
  renderWithTemplate(imageUrl: string, templateId?: string): Promise<Buffer>;
  processWithUniformPadding(
    imageUrl: string,
    options?: { minPadding?: number; shadow?: boolean; canvasSize?: number },
  ): Promise<{ buffer: Buffer; dataUrl: string }>;
}

let _cached: ImageService | null = null;
let _cachedProvider: string | null = null;

/**
 * Get the configured provider name from environment.
 * Supports both IMAGE_PROCESSOR and IMAGE_SERVICE env vars.
 */
function getProviderConfig(): ImageServiceProvider {
  const raw = (
    process.env.IMAGE_PROCESSOR ||
    process.env.IMAGE_SERVICE ||
    'auto'
  ).toLowerCase();

  // Normalize aliases
  if (raw === 'local' || raw === 'self-hosted') return 'self-hosted';
  if (raw === 'photoroom') return 'photoroom';
  return 'auto';
}

/**
 * Get the image processing service based on configuration.
 *
 * IMAGE_PROCESSOR (or IMAGE_SERVICE) env var: "self-hosted" | "photoroom" | "auto" (default: "auto")
 * - "self-hosted" / "local": Always use local service (error if unavailable)
 * - "photoroom": Always use PhotoRoom API
 * - "auto": Try local first, fall back to PhotoRoom
 *
 * IMAGE_SERVICE_URL: URL of the self-hosted service (default: http://localhost:8100)
 */
export async function getImageService(): Promise<ImageService> {
  if (_cached) return _cached;

  const mode = getProviderConfig();
  const apiKey = process.env.PHOTOROOM_API_KEY || '';

  if (mode === 'photoroom') {
    if (!apiKey) throw new Error('IMAGE_PROCESSOR=photoroom but PHOTOROOM_API_KEY not set');
    info('[ImageFactory] Using PhotoRoom API');
    _cached = new PhotoRoomService(apiKey);
    _cachedProvider = 'photoroom';
    return _cached;
  }

  if (mode === 'self-hosted' || mode === 'auto') {
    const service = new LocalPhotoRoomService(apiKey || undefined);
    const url = process.env.IMAGE_SERVICE_URL || 'http://localhost:8100';

    // Check if local is available
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        info('[ImageFactory] Using self-hosted image processing service');
        _cached = service;
        _cachedProvider = 'self-hosted';
        return _cached;
      }
    } catch {
      // Local not available
    }

    if (mode === 'self-hosted') {
      warn('[ImageFactory] IMAGE_PROCESSOR=self-hosted but local service is unavailable');
      _cached = service;
      _cachedProvider = 'self-hosted';
      return _cached;
    }

    // auto mode: fall back to PhotoRoom
    if (apiKey) {
      info('[ImageFactory] Local service unavailable, falling back to PhotoRoom API');
      _cached = new PhotoRoomService(apiKey);
      _cachedProvider = 'photoroom';
      return _cached;
    }

    info('[ImageFactory] Using local service (no PhotoRoom API key for fallback)');
    _cached = service;
    _cachedProvider = 'self-hosted';
    return _cached;
  }

  throw new Error(`Unknown IMAGE_PROCESSOR value: ${mode}`);
}

/** Get the name of the currently active provider. */
export function getActiveProvider(): string | null {
  return _cachedProvider;
}

/** Reset cached service (for testing or reconnection). */
export function resetImageService(): void {
  _cached = null;
  _cachedProvider = null;
}

/**
 * Timed wrapper: calls an image service method and logs provider + duration.
 */
export async function timedImageCall<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const provider = _cachedProvider ?? 'unknown';
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    info(`[ImageService] ${label} completed via ${provider} in ${ms}ms`);
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    warn(`[ImageService] ${label} failed via ${provider} after ${ms}ms: ${err}`);
    throw err;
  }
}
