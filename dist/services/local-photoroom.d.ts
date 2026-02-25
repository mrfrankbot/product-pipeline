import { type ProcessImageOptions } from './photoroom.js';
export declare class LocalPhotoRoomService {
    private fallback;
    constructor(photoroomApiKey?: string);
    private isLocalAvailable;
    private downloadImage;
    private callLocal;
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
    }>;
    processAllImages(imageUrls: string[], options?: ProcessImageOptions): Promise<Buffer[]>;
    renderWithTemplate(imageUrl: string, _templateId?: string): Promise<Buffer>;
    processWithUniformPadding(imageUrl: string, options?: {
        minPadding?: number;
        shadow?: boolean;
        canvasSize?: number;
    }): Promise<{
        buffer: Buffer;
        dataUrl: string;
        cleanBuffer?: Buffer;
    }>;
}
