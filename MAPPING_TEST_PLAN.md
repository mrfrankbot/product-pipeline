# Mapping System Test Plan

## Database Schema Verification

After deployment, verify the `field_mappings` table was created:

```sql
-- Check table exists
.schema field_mappings

-- Verify seeded data
SELECT mapping_type, COUNT(*) FROM field_mappings GROUP BY mapping_type;

-- Check condition mappings
SELECT * FROM field_mappings WHERE mapping_type = 'condition';

-- Check category mappings  
SELECT * FROM field_mappings WHERE mapping_type = 'category' ORDER BY source_value;

-- Check field mappings
SELECT * FROM field_mappings WHERE mapping_type = 'field';

-- Check inventory location
SELECT * FROM field_mappings WHERE mapping_type = 'inventory_location';
```

Expected counts:
- condition: 9 mappings (8 specific + 1 default)
- category: 31 mappings (30 specific + 1 default)  
- field: 4 mappings
- inventory_location: 1 mapping

## API Testing

### 1. Get All Mappings
```bash
curl "http://localhost:3000/api/mappings" -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758"
```

Expected: JSON object with keys: condition, category, field, inventory_location

### 2. Get Specific Type
```bash
curl "http://localhost:3000/api/mappings/condition" -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758"
```

Expected: Array of condition mappings

### 3. Create New Mapping
```bash
curl -X POST "http://localhost:3000/api/mappings" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{
    "mappingType": "condition",
    "sourceValue": "Refurbished", 
    "targetValue": "LIKE_NEW"
  }'
```

Expected: New mapping object returned

### 4. Update Mapping
```bash
curl -X PUT "http://localhost:3000/api/mappings/1" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{
    "targetValue": "VERY_GOOD"
  }'
```

Expected: Updated mapping object

### 5. Delete Mapping
```bash
curl -X DELETE "http://localhost:3000/api/mappings/999" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758"
```

Expected: `{"ok": true, "message": "Mapping deleted"}`

## Mapping Service Testing

### Test Condition Mapping
```javascript
// In browser console or API test:
const result = await fetch('/api/mappings/condition').then(r => r.json());
console.log(result);

// Test specific lookups:
// "Excellent" should map to "VERY_GOOD"
// "Like New" should map to "LIKE_NEW"  
// "Unknown condition" should map to default "GOOD"
```

### Test Category Mapping
```javascript
// Test category mappings:
// "Camera" should map to "31388"
// "Lens" should map to "3323"
// "Unknown type" should map to default "48519"
```

## Product Sync Integration Test

After eBay auth is working, test product sync with mapped values:

```bash
# Create test product in Shopify with:
# - Product type: "Cameras"  
# - Tags: ["Excellent", "Used"]
# - Then sync to eBay and verify:

curl -X POST "http://localhost:3000/api/sync/products?dry=true" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{"productIds": ["TEST_PRODUCT_ID"]}'

# Should use:
# - Category: 31388 (Digital Cameras)
# - Condition: VERY_GOOD (Excellent)
```

## Custom Mapping Test

Test creating custom mappings for your specific needs:

```bash
# Add custom condition for your business
curl -X POST "http://localhost:3000/api/mappings" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{
    "mappingType": "condition",
    "sourceValue": "Display Model", 
    "targetValue": "LIKE_NEW"
  }'

# Add custom category
curl -X POST "http://localhost:3000/api/mappings" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{
    "mappingType": "category",
    "sourceValue": "Vintage Cameras", 
    "targetValue": "15230"
  }'
```

## Error Testing

### Invalid Requests
```bash
# Missing required fields
curl -X POST "http://localhost:3000/api/mappings" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{
    "mappingType": "condition"
  }'

# Expected: 400 error - "mappingType and targetValue are required"
```

### Nonexistent Resources
```bash
# Update non-existent mapping
curl -X PUT "http://localhost:3000/api/mappings/99999" \
  -H "X-API-Key: ebay-sync-74e34e328df0e5aa431d712209ef4758" \
  -H "Content-Type: application/json" \
  -d '{"targetValue": "NEW"}'

# Expected: 404 error - "Mapping not found"
```

## Success Criteria

✅ Database table created with correct schema  
✅ Default mappings seeded correctly  
✅ All API endpoints work as expected  
✅ Mapping service finds exact matches  
✅ Mapping service finds partial matches  
✅ Mapping service falls back to defaults  
✅ Product sync uses database mappings instead of hardcoded  
✅ Custom mappings can be created/updated/deleted  
✅ Default flags work correctly (only one default per type)

## Manual Configuration Guide

After testing, Chris can customize mappings for his business:

1. **Review default conditions** - adjust if needed for your grading scale
2. **Add custom categories** - for specific product types you sell  
3. **Set business-specific defaults** - based on your most common items
4. **Test with real products** - ensure mappings work with your actual inventory

The system is now fully configurable without code changes!