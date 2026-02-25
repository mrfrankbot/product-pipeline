/**
 * PhotoRoom API integration for automatic product image processing.
 *
 * Two endpoints are used:
 *   - Remove Background (Basic plan):  POST https://sdk.photoroom.com/v1/segment
 *   - Image Editing    (Plus plan):    POST https://image-api.photoroom.com/v2/edit
 *
 * Auth: x-api-key header with the API key.
 */
export interface ProcessImageOptions {
    /** Background color hex (without #), e.g. "FFFFFF". Default: "FFFFFF" (white). */
    background?: string;
    /** Add a realistic AI drop-shadow. Default: true. */
    shadow?: boolean;
    /** Padding ratio around the subject (0–1). Default: 0.1 (10%). */
    padding?: number;
}
export declare class PhotoRoomService {
    private apiKey;
    constructor(apiKey: string);
    removeBackground(imageUrl: string): Promise<Buffer>;
    processProductImage(imageUrl: string, options?: ProcessImageOptions): Promise<Buffer>;
    /**
     * Process an image with consistent edge padding:
     * 1. Remove background via PhotoRoom (no padding, no fixed size)
     * 2. Trim to product bounds
     * 3. Add shadow
     * 4. Place on white canvas with uniform closest-edge padding (default 100px)
     * 5. Apply template overlay
     *
     * The closest edge of the product to the image edge will always have
     * `minPadding` pixels of white space. Other edges get proportionally more.
     * Final output is 1200x1200.
     */
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
    /**
     * Process an image with caller-specified PhotoRoom parameters.
     * Applies background removal, padding, shadow, AND template overlay.
     *
     * Returns a base64 data URL of the final processed image.
     */
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
    /**
     * Render an image using a PhotoRoom template.
     *
     * Endpoint: POST https://image-api.photoroom.com/v1/render
     * Accepts `templateId` + `imageUrl` (or imageFile) via multipart/form-data.
     * Returns the rendered image as a Buffer.
     */
    renderWithTemplate(imageUrl: string, templateId?: string): Promise<Buffer>;
    private downloadImage;
    private buildFormData;
}
