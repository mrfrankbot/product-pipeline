import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, getRawDb } from '../db/client.js';
import { info, error as logError } from '../utils/logger.js';

// Route imports
import healthRoutes from './routes/health.js';
import apiRoutes from './routes/api.js';
import ebayNotificationRoutes from './routes/ebay-notifications.js';
import shopifyWebhookRoutes from './routes/shopify-webhooks.js';
import shopifyAuthRoutes from './routes/shopify-auth.js';
import ebayAuthRoutes from './routes/ebay-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// --- Middleware ---

// CORS for Shopify admin embed
app.use(cors({
  origin: [
    'https://admin.shopify.com',
    'https://usedcameragear.myshopify.com',
    /\.shopify\.com$/,
  ],
  credentials: true,
}));

// Raw body for webhook HMAC verification (must come before json parser)
app.use('/webhooks/shopify', express.raw({ type: 'application/json' }), (req, _res, next) => {
  (req as any).rawBody = req.body;
  if (Buffer.isBuffer(req.body)) {
    req.body = JSON.parse(req.body.toString('utf8'));
  }
  next();
});

// Raw body for eBay XML notifications
app.use('/webhooks/ebay', express.text({ type: ['text/xml', 'application/xml', 'application/soap+xml'] }));

// JSON for everything else
app.use(express.json());

// --- Routes ---
app.use(healthRoutes);
app.use(apiRoutes);
app.use(ebayNotificationRoutes);
app.use(shopifyWebhookRoutes);
app.use(shopifyAuthRoutes);
app.use(ebayAuthRoutes);

// Serve static frontend (built Vite app)
const webDistPath = path.join(__dirname, '..', '..', 'dist', 'web');
app.use(express.static(webDistPath));

// SPA fallback — serve index.html for any non-API route
// Express 5 uses named catch-all params: {*path}
app.get('/{*path}', (req, res) => {
  // Don't serve HTML for API/webhook routes
  if (req.path.startsWith('/api') || req.path.startsWith('/webhooks') || req.path.startsWith('/auth') || req.path.startsWith('/ebay/auth') || req.path === '/health') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.sendFile(path.join(webDistPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).json({
        app: 'EbaySync',
        version: '0.2.0',
        message: 'Frontend not built yet. Run: npm run build:web',
        endpoints: {
          health: '/health',
          api: '/api/status',
          ebayWebhook: 'POST /webhooks/ebay/notifications',
          shopifyWebhook: 'POST /webhooks/shopify/:topic',
          auth: '/auth?shop=usedcameragear.myshopify.com',
        },
      });
    }
  });
});

// --- Initialize and Start ---
async function start() {
  try {
    // Initialize database (creates tables if needed)
    await getDb();
    const rawDb = await getRawDb();
    info('[Server] Database initialized');

    // Ensure new tables exist
    initExtraTables(rawDb);

    // Seed default settings
    seedDefaultSettings(rawDb);

    app.listen(PORT, () => {
      info(`[Server] EbaySync running on http://localhost:${PORT}`);
      info(`[Server] Health: http://localhost:${PORT}/health`);
      info(`[Server] API: http://localhost:${PORT}/api/status`);
    });

    // Start background sync scheduler
    startSyncScheduler(rawDb);

  } catch (err) {
    logError(`[Server] Failed to start: ${err}`);
    process.exit(1);
  }
}

/**
 * Create extra tables for the web app (notification_log, settings)
 */
function initExtraTables(db: import('better-sqlite3').Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      processedAt TEXT,
      status TEXT DEFAULT 'received',
      error TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  info('[Server] Extra tables initialized');
}

/**
 * Seed default settings if they don't exist
 */
function seedDefaultSettings(db: import('better-sqlite3').Database) {
  const defaults: Record<string, string> = {
    sync_price: 'true',
    sync_inventory: 'true',
    auto_list: 'false',
    sync_interval_minutes: '5',
    item_location: '305 W 700 S, Salt Lake City, UT 84101',
  };

  const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(key, value);
  }
}

/**
 * Background sync scheduler — fallback polling every N minutes
 */
function startSyncScheduler(db: import('better-sqlite3').Database) {
  const getInterval = (): number => {
    try {
      const row = db.prepare(`SELECT value FROM settings WHERE key = 'sync_interval_minutes'`).get() as any;
      return (parseInt(row?.value) || 5) * 60 * 1000;
    } catch {
      return 5 * 60 * 1000;
    }
  };

  // Run first sync after 30 seconds
  setTimeout(async () => {
    info('[Scheduler] Running initial background sync...');
    await runBackgroundSync();
  }, 30_000);

  // Then run on interval
  setInterval(async () => {
    await runBackgroundSync();
  }, getInterval());

  info(`[Scheduler] Background sync every ${getInterval() / 60000} minutes`);
}

async function runBackgroundSync() {
  try {
    const { runOrderSync } = await import('./sync-helper.js');
    const result = await runOrderSync({ dryRun: false });
    if (result && result.imported > 0) {
      info(`[Scheduler] Background sync: ${result.imported} orders imported`);
    }
  } catch (err) {
    logError(`[Scheduler] Background sync error: ${err}`);
  }
}

start();
