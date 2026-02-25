/**
 * Simple API key authentication middleware
 * Checks for X-API-Key header or api_key query parameter
 */
export const apiKeyAuth = (req, res, next) => {
    // Skip auth for health check
    if (req.path === '/health') {
        return next();
    }
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        // If no API key is set in env, allow access (development mode)
        return next();
    }
    // Allow same-origin requests from the SPA frontend (no API key needed)
    const referer = req.headers.referer || req.headers.origin || '';
    const host = req.headers.host || '';
    if (referer && (referer.includes(host) || referer.includes('ebay-sync-app-production.up.railway.app'))) {
        return next();
    }
    const providedKey = req.headers['x-api-key'] || req.query.api_key;
    if (!providedKey || providedKey !== apiKey) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
    next();
};
/**
 * Rate limiting middleware (basic token bucket implementation)
 */
const rateLimitStore = new Map();
const RATE_LIMIT_REQUESTS = 100; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
export const rateLimit = (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = rateLimitStore.get(clientIp);
    if (!bucket) {
        bucket = { tokens: RATE_LIMIT_REQUESTS, lastRefill: now };
        rateLimitStore.set(clientIp, bucket);
    }
    // Refill tokens based on time elapsed
    const timeDiff = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(timeDiff / RATE_LIMIT_WINDOW_MS * RATE_LIMIT_REQUESTS);
    bucket.tokens = Math.min(RATE_LIMIT_REQUESTS, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
        res.set({
            'X-RateLimit-Limit': RATE_LIMIT_REQUESTS.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(now + RATE_LIMIT_WINDOW_MS).toISOString(),
        });
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    bucket.tokens--;
    res.set({
        'X-RateLimit-Limit': RATE_LIMIT_REQUESTS.toString(),
        'X-RateLimit-Remaining': bucket.tokens.toString(),
        'X-RateLimit-Reset': new Date(bucket.lastRefill + RATE_LIMIT_WINDOW_MS).toISOString(),
    });
    next();
};
