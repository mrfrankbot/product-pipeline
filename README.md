# EbaySync - Shopify ↔ eBay Sync Tool

CLI-first tool to sync products from UsedCameraGear.com (Shopify) to eBay, and sync eBay orders back to Shopify. Replaces Marketplace Connect (Codisto).

## Architecture

- **TypeScript** with Commander.js CLI
- **Shopify Admin API** (GraphQL) for product/order/inventory management
- **eBay APIs**: Browse, Inventory, Trading, Fulfillment
- **SQLite** local database for sync state tracking
- **Node.js 20+**

## Credentials

All stored in `~/.clawdbot/credentials/`:
- `ebay-api.txt` - eBay App ID, Dev ID, Cert ID
- `shopify-usedcameragear-api.txt` - Shopify Client ID + Secret

## Commands

```bash
# Authentication
ebaysync auth shopify     # OAuth flow for Shopify access token
ebaysync auth ebay        # OAuth flow for eBay user token
ebaysync auth status      # Check auth status for both platforms

# Products
ebaysync products list              # List Shopify products
ebaysync products sync              # Sync Shopify products → eBay listings
ebaysync products sync --dry-run    # Preview what would be synced
ebaysync products sync --sku ABC    # Sync specific product

# Orders
ebaysync orders poll                # Poll eBay for new orders
ebaysync orders sync                # Sync eBay orders → Shopify
ebaysync orders sync --dry-run      # Preview order sync

# Inventory
ebaysync inventory sync             # Sync inventory levels bidirectionally
ebaysync inventory check            # Compare inventory across platforms

# Status
ebaysync status                     # Overall sync health
```

## Flags (all commands)
- `--json` - JSON output for automation
- `--dry-run` - Preview changes without applying
- `--verbose` - Detailed logging

## Store Details
- **Shopify Store**: usedcameragear.myshopify.com (usedcameragear.com)
- **eBay Account**: Connected via TradeInManager app credentials
- **Product Types**: Used camera gear (cameras, lenses, accessories)

## Development
```bash
npm install
npm run build
npm link  # Makes `ebaysync` available globally
```
