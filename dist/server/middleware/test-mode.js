/**
 * TEST_MODE middleware — when TEST_MODE=true env var is set,
 * injects a mock Shopify session and skips auth so automated
 * browser testing tools can hit every route on localhost.
 */
export const isTestMode = () => process.env.TEST_MODE === 'true';
/** Mock session injected into req when TEST_MODE is active */
const MOCK_SESSION = {
    shop: 'test-store.myshopify.com',
    accessToken: 'test-token',
    scope: 'read_products,write_products,read_orders',
    isOnline: false,
    state: 'test-state',
    id: 'test-session-id',
};
/**
 * Middleware: if TEST_MODE, attach mock session to request
 * and skip any Shopify auth checks.
 */
export const testModeMiddleware = (req, _res, next) => {
    if (isTestMode()) {
        req.shopifySession = MOCK_SESSION;
        req.session = MOCK_SESSION;
    }
    next();
};
/**
 * GET /api/test-mode — lets QA agents verify if test mode is active.
 */
export const testModeRoute = (_req, res) => {
    res.json({ testMode: isTestMode() });
};
