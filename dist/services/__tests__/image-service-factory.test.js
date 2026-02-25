import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// We'll test the factory logic by manipulating env vars and mocking fetch
describe('ImageServiceFactory', () => {
    let originalEnv;
    beforeEach(() => {
        originalEnv = { ...process.env };
        // Reset module cache for each test
        vi.resetModules();
    });
    afterEach(() => {
        process.env = originalEnv;
    });
    async function loadFactory() {
        const mod = await import('../image-service-factory.js');
        mod.resetImageService();
        return mod;
    }
    it('should default to auto mode when no env vars set', async () => {
        delete process.env.IMAGE_PROCESSOR;
        delete process.env.IMAGE_SERVICE;
        delete process.env.PHOTOROOM_API_KEY;
        const { getImageService } = await loadFactory();
        // With no local service and no API key, should still return a service
        const service = await getImageService();
        expect(service).toBeDefined();
    });
    it('should use PhotoRoom when IMAGE_PROCESSOR=photoroom', async () => {
        process.env.IMAGE_PROCESSOR = 'photoroom';
        process.env.PHOTOROOM_API_KEY = 'test-key-123';
        const { getImageService, getActiveProvider } = await loadFactory();
        const service = await getImageService();
        expect(service).toBeDefined();
        expect(getActiveProvider()).toBe('photoroom');
    });
    it('should throw when IMAGE_PROCESSOR=photoroom but no API key', async () => {
        process.env.IMAGE_PROCESSOR = 'photoroom';
        delete process.env.PHOTOROOM_API_KEY;
        const { getImageService } = await loadFactory();
        await expect(getImageService()).rejects.toThrow('PHOTOROOM_API_KEY not set');
    });
    it('should support IMAGE_SERVICE as alias for IMAGE_PROCESSOR', async () => {
        delete process.env.IMAGE_PROCESSOR;
        process.env.IMAGE_SERVICE = 'photoroom';
        process.env.PHOTOROOM_API_KEY = 'test-key-456';
        const { getImageService, getActiveProvider } = await loadFactory();
        await getImageService();
        expect(getActiveProvider()).toBe('photoroom');
    });
    it('IMAGE_PROCESSOR takes precedence over IMAGE_SERVICE', async () => {
        process.env.IMAGE_PROCESSOR = 'photoroom';
        process.env.IMAGE_SERVICE = 'local';
        process.env.PHOTOROOM_API_KEY = 'test-key';
        const { getImageService, getActiveProvider } = await loadFactory();
        await getImageService();
        expect(getActiveProvider()).toBe('photoroom');
    });
    it('should cache the service on subsequent calls', async () => {
        process.env.IMAGE_PROCESSOR = 'photoroom';
        process.env.PHOTOROOM_API_KEY = 'test-key';
        const { getImageService } = await loadFactory();
        const service1 = await getImageService();
        const service2 = await getImageService();
        expect(service1).toBe(service2);
    });
    it('resetImageService should clear the cache', async () => {
        process.env.IMAGE_PROCESSOR = 'photoroom';
        process.env.PHOTOROOM_API_KEY = 'test-key';
        const { getImageService, resetImageService, getActiveProvider } = await loadFactory();
        await getImageService();
        expect(getActiveProvider()).toBe('photoroom');
        resetImageService();
        expect(getActiveProvider()).toBeNull();
    });
    it('should recognize "self-hosted" and "local" as the same mode', async () => {
        delete process.env.PHOTOROOM_API_KEY;
        for (const val of ['self-hosted', 'local']) {
            process.env.IMAGE_PROCESSOR = val;
            const { getImageService, getActiveProvider } = await loadFactory();
            await getImageService();
            expect(getActiveProvider()).toBe('self-hosted');
        }
    });
    it('timedImageCall should log and return results', async () => {
        const { timedImageCall } = await loadFactory();
        const result = await timedImageCall('test-op', async () => 'hello');
        expect(result).toBe('hello');
    });
    it('timedImageCall should rethrow errors', async () => {
        const { timedImageCall } = await loadFactory();
        await expect(timedImageCall('fail-op', async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
    });
    describe('auto mode fallback', () => {
        it('should fall back to PhotoRoom when local is unavailable', async () => {
            delete process.env.IMAGE_PROCESSOR;
            delete process.env.IMAGE_SERVICE;
            process.env.PHOTOROOM_API_KEY = 'test-key';
            process.env.IMAGE_SERVICE_URL = 'http://localhost:99999'; // won't connect
            const { getImageService, getActiveProvider } = await loadFactory();
            await getImageService();
            // In auto mode with unavailable local, should fall back to photoroom
            expect(getActiveProvider()).toBe('photoroom');
        });
    });
});
