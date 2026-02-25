import type { ProcessImageOptions } from './photoroom.js';
export type ImageServiceProvider = 'self-hosted' | 'photoroom' | 'auto';
export interface ImageService {
    removeBackground(imageUrl: string): Promise<Buffer>;
    processProductImage(imageUrl: string, options?: ProcessImageOptions): Promise<Buffer>;
    processWithParams(imageUrl: string, params: {
        background?: string;
        padding?: number;
        shadow?: boolean;
    }): Promise<{
        buffer: Buffer;
        dataUrl: string;
        cleanBuffer?: Buffer;
        cutoutBuffer?: Buffer;
    }>;
    processAllImages(imageUrls: string[], options?: ProcessImageOptions): Promise<Buffer[]>;
    renderWithTemplate(imageUrl: string, templateId?: string): Promise<Buffer>;
    processWithUniformPadding(imageUrl: string, options?: {
        minPadding?: number;
        shadow?: boolean;
        canvasSize?: number;
    }): Promise<{
        buffer: Buffer;
        dataUrl: string;
        cleanBuffer?: Buffer;
        cutoutBuffer?: Buffer;
    }>;
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
export declare function getImageService(): Promise<ImageService>;
/** Get the name of the currently active provider. */
export declare function getActiveProvider(): string | null;
/** Reset cached service (for testing or reconnection). */
export declare function resetImageService(): void;
/**
 * Timed wrapper: calls an image service method and logs provider + duration.
 */
export declare function timedImageCall<T>(label: string, fn: () => Promise<T>): Promise<T>;
