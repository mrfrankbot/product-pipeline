import { info, warn, error as logError } from '../utils/logger.js';
import sharp from 'sharp';

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

export class PhotoRoomService {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('PhotoRoomService requires an API key');
    this.apiKey = apiKey;
  }

  // ── Remove background only (Basic plan) ──────────────────────────────

  async removeBackground(imageUrl: string): Promise<Buffer> {
    info(`[PhotoRoom] Removing background: ${imageUrl}`);

    const imageBuffer = await this.downloadImage(imageUrl);
    const formData = this.buildFormData(imageBuffer, 'image.jpg');
    formData.append('format', 'png');
    formData.append('channels', 'rgba');

    const response = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      logError(`[PhotoRoom] Remove background failed (${response.status}): ${text}`);
      throw new Error(`PhotoRoom remove background failed: ${response.status} — ${text}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    info(`[PhotoRoom] Background removed successfully (${arrayBuffer.byteLength} bytes)`);
    return Buffer.from(arrayBuffer);
  }

  // ── Full image processing (Plus plan) ────────────────────────────────

  async processProductImage(
    imageUrl: string,
    options?: ProcessImageOptions,
  ): Promise<Buffer> {
    const bg = options?.background ?? 'FFFFFF';
    const shadow = options?.shadow ?? true;
    const padding = options?.padding ?? 0.1;

    info(`[PhotoRoom] Processing image: ${imageUrl} (bg=${bg}, shadow=${shadow}, padding=${padding})`);

    const imageBuffer = await this.downloadImage(imageUrl);
    const formData = this.buildFormData(imageBuffer, 'image.jpg');

    // Image Editing API parameters
    formData.append('removeBackground', 'true');
    formData.append('background.color', bg);
    formData.append('padding', String(padding));

    if (shadow) {
      formData.append('shadow.mode', 'ai.soft');
    }

    // Output as PNG at a reasonable size
    formData.append('outputSize', '1200x1200');

    const response = await fetch('https://image-api.photoroom.com/v2/edit', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      logError(`[PhotoRoom] Image processing failed (${response.status}): ${text}`);
      throw new Error(`PhotoRoom image processing failed: ${response.status} — ${text}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    info(`[PhotoRoom] Image processed successfully (${arrayBuffer.byteLength} bytes)`);
    return Buffer.from(arrayBuffer);
  }

  // ── Process with uniform padding ───────────────────────────────────────

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
  async processWithUniformPadding(
    imageUrl: string,
    options?: { minPadding?: number; shadow?: boolean; canvasSize?: number },
  ): Promise<{ buffer: Buffer; dataUrl: string; cleanBuffer?: Buffer }> {
    const minPad = options?.minPadding ?? 100;
    const shadow = options?.shadow ?? true;
    const canvasSize = options?.canvasSize ?? 1200;

    info(`[PhotoRoom] Processing with uniform padding (${minPad}px min): ${imageUrl.substring(0, 60)}...`);

    // Step 0: Download, auto-rotate, and resize for PhotoRoom (max 2000px — saves bandwidth + speed)
    const rawBuffer = await this.downloadImage(imageUrl);
    const imageBuffer = await sharp(rawBuffer)
      .rotate() // auto-rotate from EXIF
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    info(`[PhotoRoom] Sending ${(imageBuffer.length / 1024).toFixed(0)}KB image to PhotoRoom API`);
    const formData = this.buildFormData(imageBuffer, 'image.jpg');
    formData.append('removeBackground', 'true');
    formData.append('background.color', 'transparent');
    if (shadow) {
      formData.append('shadow.mode', 'ai.soft');
    }

    const response = await fetch('https://image-api.photoroom.com/v2/edit', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey },
      body: formData,
      signal: AbortSignal.timeout(60_000), // 60 second timeout per image
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PhotoRoom bg removal failed: ${response.status} — ${text}`);
    }

    const bgRemovedBuffer = Buffer.from(await response.arrayBuffer());
    info(`[PhotoRoom] Background removed (${bgRemovedBuffer.length} bytes)`);

    // Step 2: Trim transparent pixels to get tight crop around product
    const trimmed = await sharp(bgRemovedBuffer)
      .trim()
      .toBuffer({ resolveWithObject: true });

    const { width: prodW, height: prodH } = trimmed.info;
    info(`[PhotoRoom] Product trimmed to ${prodW}x${prodH}`);

    // Step 3: Calculate scaling to fit in canvas with minimum padding
    const availW = canvasSize - (2 * minPad);
    const availH = canvasSize - (2 * minPad);
    const scale = Math.min(availW / prodW, availH / prodH);
    const scaledW = Math.round(prodW * scale);
    const scaledH = Math.round(prodH * scale);

    // Step 4: Resize product and place centered on white canvas
    const resizedProduct = await sharp(trimmed.data)
      .resize(scaledW, scaledH, { fit: 'inside' })
      .toBuffer();

    const left = Math.round((canvasSize - scaledW) / 2);
    const top = Math.round((canvasSize - scaledH) / 2);

    const finalBuffer = await sharp({
      create: {
        width: canvasSize,
        height: canvasSize,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: resizedProduct, left, top }])
      .png()
      .toBuffer();

    info(`[PhotoRoom] Placed on ${canvasSize}x${canvasSize} canvas (product: ${scaledW}x${scaledH}, offset: ${left},${top}, closest edge: ${Math.min(left, top)}px)`);

    // Save the clean product-on-white canvas (no watermarks) for the photo editor
    const cleanBuffer = finalBuffer;

    // Step 5: Apply template overlay
    try {
      const base64 = finalBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      const templateBuffer = await this.renderWithTemplate(dataUrl);
      const templateBase64 = templateBuffer.toString('base64');
      return { buffer: templateBuffer, dataUrl: `data:image/png;base64,${templateBase64}`, cleanBuffer };
    } catch (templateErr) {
      warn(`[PhotoRoom] Template overlay failed, returning without template: ${templateErr}`);
      const base64 = finalBuffer.toString('base64');
      return { buffer: finalBuffer, dataUrl: `data:image/png;base64,${base64}`, cleanBuffer };
    }
  }

  // ── Process with custom parameters ────────────────────────────────────

  /**
   * Process an image with caller-specified PhotoRoom parameters.
   * Applies background removal, padding, shadow, AND template overlay.
   *
   * Returns a base64 data URL of the final processed image.
   */
  async processWithParams(
    imageUrl: string,
    params: { background?: string; padding?: number; shadow?: boolean },
  ): Promise<{ buffer: Buffer; dataUrl: string; cleanBuffer?: Buffer }> {
    const options: ProcessImageOptions = {
      background: (params.background ?? '#FFFFFF').replace(/^#/, ''),
      padding: params.padding ?? 0.1,
      shadow: params.shadow ?? true,
    };

    // Step 1: Process image (background removal + padding + shadow)
    const processedBuffer = await this.processProductImage(imageUrl, options);
    
    // Step 2: Convert buffer to data URL and use as input for template rendering
    const base64 = processedBuffer.toString('base64');
    const processedDataUrl = `data:image/png;base64,${base64}`;
    
    try {
      // Step 3: Apply PhotoRoom template overlay to the processed image
      info(`[PhotoRoom] Applying template overlay to processed image`);
      const templateBuffer = await this.renderWithTemplate(processedDataUrl);
      
      const templateBase64 = templateBuffer.toString('base64');
      const finalDataUrl = `data:image/png;base64,${templateBase64}`;
      
      return { buffer: templateBuffer, dataUrl: finalDataUrl };
    } catch (templateError) {
      warn(`[PhotoRoom] Template overlay failed, returning processed image without template: ${templateError}`);
      // Fall back to processed image without template if template rendering fails
      return { buffer: processedBuffer, dataUrl: processedDataUrl };
    }
  }

  // ── Batch processing ─────────────────────────────────────────────────

  async processAllImages(
    imageUrls: string[],
    options?: ProcessImageOptions,
  ): Promise<Buffer[]> {
    info(`[PhotoRoom] Batch processing ${imageUrls.length} images`);
    const results: Buffer[] = [];

    for (const url of imageUrls) {
      try {
        const processed = await this.processProductImage(url, options);
        results.push(processed);
      } catch (err) {
        warn(`[PhotoRoom] Failed to process image ${url}: ${err}`);
        // Still attempt remaining images; push a fallback (download original)
        try {
          const fallback = await this.downloadImage(url);
          results.push(fallback);
        } catch {
          logError(`[PhotoRoom] Could not even download fallback for ${url}`);
        }
      }
    }

    info(`[PhotoRoom] Batch complete: ${results.length}/${imageUrls.length} images`);
    return results;
  }

  // ── Render with template ──────────────────────────────────────────────

  /**
   * Render an image using a PhotoRoom template.
   *
   * Endpoint: POST https://image-api.photoroom.com/v1/render
   * Accepts `templateId` + `imageUrl` (or imageFile) via multipart/form-data.
   * Returns the rendered image as a Buffer.
   */
  async renderWithTemplate(
    imageUrl: string,
    templateId?: string,
  ): Promise<Buffer> {
    const tplId =
      templateId ||
      process.env.PHOTOROOM_TEMPLATE_ID ||
      '014ca360-cb57-416e-8c17-365a647ca4ac';

    info(`[PhotoRoom] Rendering with template ${tplId}: ${imageUrl.substring(0, 60)}...`);

    const formData = new FormData();
    formData.append('templateId', tplId);

    // If input is a data URL or buffer, send as imageFile; otherwise use imageUrl
    if (imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer as unknown as BlobPart]);
      formData.append('imageFile', blob, 'image.png');
    } else {
      formData.append('imageUrl', imageUrl);
    }

    const response = await fetch('https://image-api.photoroom.com/v1/render', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      logError(`[PhotoRoom] Template render failed (${response.status}): ${text}`);
      throw new Error(`PhotoRoom template render failed: ${response.status} — ${text}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    info(`[PhotoRoom] Template render successful (${arrayBuffer.byteLength} bytes)`);
    return Buffer.from(arrayBuffer);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private async downloadImage(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Failed to download image (${res.status}): ${url}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private buildFormData(imageBuffer: Buffer, filename: string): FormData {
    const blob = new Blob([imageBuffer as unknown as BlobPart]);
    const formData = new FormData();
    formData.append('imageFile', blob, filename);
    return formData;
  }
}
