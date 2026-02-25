import { info, warn, error as logError } from '../utils/logger.js';
import { PhotoRoomService } from './photoroom.js';
const LOCAL_SERVICE_URL = process.env.IMAGE_SERVICE_URL || 'http://localhost:8100';
export class LocalPhotoRoomService {
    fallback;
    constructor(photoroomApiKey) {
        this.fallback = photoroomApiKey ? new PhotoRoomService(photoroomApiKey) : null;
    }
    async isLocalAvailable() {
        try {
            const res = await fetch(`${LOCAL_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async downloadImage(url) {
        if (url.startsWith('data:')) {
            const base64Data = url.split(',')[1];
            return Buffer.from(base64Data, 'base64');
        }
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Failed to download image (${res.status}): ${url}`);
        return Buffer.from(await res.arrayBuffer());
    }
    async callLocal(endpoint, imageBuffer, extraFields) {
        const formData = new FormData();
        const blob = new Blob([imageBuffer]);
        formData.append('image', blob, 'image.jpg');
        if (extraFields) {
            for (const [k, v] of Object.entries(extraFields)) {
                formData.append(k, v);
            }
        }
        const res = await fetch(`${LOCAL_SERVICE_URL}${endpoint}`, { method: 'POST', body: formData });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Local image service ${endpoint} failed (${res.status}): ${text}`);
        }
        return Buffer.from(await res.arrayBuffer());
    }
    async removeBackground(imageUrl) {
        info(`[LocalPhotoRoom] Removing background: ${imageUrl.substring(0, 60)}...`);
        if (await this.isLocalAvailable()) {
            const imageBuffer = await this.downloadImage(imageUrl);
            return this.callLocal('/remove-background', imageBuffer);
        }
        if (this.fallback) {
            warn('[LocalPhotoRoom] Local service unavailable, falling back to PhotoRoom API');
            return this.fallback.removeBackground(imageUrl);
        }
        throw new Error('Local image service unavailable and no PhotoRoom API key configured');
    }
    async processProductImage(imageUrl, options) {
        const bg = options?.background ?? 'FFFFFF';
        const shadow = options?.shadow ?? true;
        const padding = options?.padding ?? 0.1;
        info(`[LocalPhotoRoom] Processing: ${imageUrl.substring(0, 60)}... (bg=${bg}, shadow=${shadow}, padding=${padding})`);
        if (await this.isLocalAvailable()) {
            const imageBuffer = await this.downloadImage(imageUrl);
            return this.callLocal('/process', imageBuffer, {
                background: bg,
                padding: String(padding),
                shadow: String(shadow),
            });
        }
        if (this.fallback) {
            warn('[LocalPhotoRoom] Local service unavailable, falling back to PhotoRoom API');
            return this.fallback.processProductImage(imageUrl, options);
        }
        throw new Error('Local image service unavailable and no PhotoRoom API key configured');
    }
    async processWithParams(imageUrl, params) {
        const bg = (params.background ?? '#FFFFFF').replace(/^#/, '');
        const padding = params.padding ?? 0.1;
        const shadow = params.shadow ?? true;
        info(`[LocalPhotoRoom] processWithParams: ${imageUrl.substring(0, 60)}...`);
        if (await this.isLocalAvailable()) {
            const imageBuffer = await this.downloadImage(imageUrl);
            const result = await this.callLocal('/process-full', imageBuffer, {
                background: bg,
                padding: String(padding),
                shadow: String(shadow),
            });
            const base64 = result.toString('base64');
            return { buffer: result, dataUrl: `data:image/png;base64,${base64}` };
        }
        if (this.fallback) {
            warn('[LocalPhotoRoom] Local service unavailable, falling back to PhotoRoom API');
            return this.fallback.processWithParams(imageUrl, params);
        }
        throw new Error('Local image service unavailable and no PhotoRoom API key configured');
    }
    async processAllImages(imageUrls, options) {
        info(`[LocalPhotoRoom] Batch processing ${imageUrls.length} images`);
        const results = [];
        for (const url of imageUrls) {
            try {
                results.push(await this.processProductImage(url, options));
            }
            catch (err) {
                warn(`[LocalPhotoRoom] Failed to process ${url}: ${err}`);
                try {
                    results.push(await this.downloadImage(url));
                }
                catch {
                    logError(`[LocalPhotoRoom] Could not download fallback for ${url}`);
                }
            }
        }
        info(`[LocalPhotoRoom] Batch complete: ${results.length}/${imageUrls.length}`);
        return results;
    }
    async renderWithTemplate(imageUrl, _templateId) {
        info(`[LocalPhotoRoom] Rendering template: ${imageUrl.substring(0, 60)}...`);
        if (await this.isLocalAvailable()) {
            const imageBuffer = await this.downloadImage(imageUrl);
            return this.callLocal('/render-template', imageBuffer);
        }
        if (this.fallback) {
            warn('[LocalPhotoRoom] Local service unavailable, falling back to PhotoRoom API');
            return this.fallback.renderWithTemplate(imageUrl, _templateId);
        }
        throw new Error('Local image service unavailable and no PhotoRoom API key configured');
    }
    async processWithUniformPadding(imageUrl, options) {
        // Always delegate to PhotoRoom API for this — needs sharp
        if (this.fallback) {
            return this.fallback.processWithUniformPadding(imageUrl, options);
        }
        throw new Error('processWithUniformPadding requires PhotoRoom API fallback');
    }
}
