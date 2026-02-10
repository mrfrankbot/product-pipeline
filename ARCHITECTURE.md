# Architecture

## Project Structure

```
ebay-sync-app/
├── src/
│   ├── cli/
│   │   ├── index.ts          # CLI entry point (Commander.js)
│   │   ├── auth.ts           # auth commands
│   │   ├── products.ts       # product sync commands
│   │   ├── orders.ts         # order sync commands
│   │   ├── inventory.ts      # inventory sync commands
│   │   └── status.ts         # status command
│   ├── shopify/
│   │   ├── client.ts         # Shopify GraphQL client
│   │   ├── products.ts       # Product CRUD
│   │   ├── orders.ts         # Order CRUD
│   │   └── inventory.ts      # Inventory management
│   ├── ebay/
│   │   ├── client.ts         # eBay API client (REST)
│   │   ├── auth.ts           # eBay OAuth flow
│   │   ├── inventory.ts      # eBay Inventory API (create/update offers)
│   │   ├── trading.ts        # eBay Trading API (legacy, if needed)
│   │   ├── fulfillment.ts    # eBay order/fulfillment
│   │   └── browse.ts         # eBay Browse API (read listings)
│   ├── sync/
│   │   ├── product-sync.ts   # Shopify → eBay product sync logic
│   │   ├── order-sync.ts     # eBay → Shopify order sync logic
│   │   ├── inventory-sync.ts # Bidirectional inventory sync
│   │   └── mapper.ts         # Data mapping between platforms
│   ├── db/
│   │   ├── schema.ts         # SQLite schema (drizzle-orm)
│   │   ├── client.ts         # Database connection
│   │   └── migrations/       # Schema migrations
│   ├── config/
│   │   └── credentials.ts    # Load credentials from ~/.clawdbot/credentials/
│   └── utils/
│       ├── logger.ts         # Structured logging
│       └── retry.ts          # Retry with backoff
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── README.md
```

## Data Flow

### Product Sync (Shopify → eBay)
1. Fetch products from Shopify (GraphQL)
2. Check local DB for existing eBay listing IDs
3. For new products: Create eBay inventory item + offer
4. For existing products: Update eBay inventory item + offer
5. Store mapping in local SQLite DB

### Order Sync (eBay → Shopify)
1. Poll eBay for new orders (Fulfillment API)
2. Check local DB to avoid duplicate imports
3. Create corresponding Shopify order
4. Mark eBay order as acknowledged
5. Store mapping in local SQLite DB

### Inventory Sync (Bidirectional)
1. Compare inventory levels across platforms
2. When Shopify inventory changes → update eBay quantity
3. When eBay order placed → decrement Shopify inventory
4. Use local DB as source of truth for sync state

## Key Decisions
- **SQLite over Postgres**: No server needed, portable, runs anywhere
- **GraphQL for Shopify**: More efficient than REST, get exactly what we need
- **REST for eBay**: eBay's APIs are REST-based
- **Commander.js**: Battle-tested CLI framework, supports subcommands well
- **drizzle-orm**: Type-safe, lightweight ORM for SQLite

## eBay API Strategy
- **Inventory API** (RESTful): For creating/managing listings (preferred)
- **Trading API** (XML/SOAP): Fallback for features not in Inventory API
- **Browse API**: For reading/searching listings
- **Fulfillment API**: For order management

## Auth Strategy
- **Shopify**: OAuth 2.0 via Custom App (Client ID + Secret → access token)
- **eBay**: OAuth 2.0 User Token (Client ID + Secret + user consent → refresh token)
- Both tokens stored locally with auto-refresh
