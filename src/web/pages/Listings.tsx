import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Divider,
  IndexTable,
  InlineStack,
  BlockStack,
  Layout,
  List,
  Page,
  Pagination,
  Spinner,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris';
import { ExternalLink, RotateCw, Search, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, useListings, useMappings, useProductOverrides, useSaveProductOverrides, useSyncProducts } from '../hooks/useApi';
import { useAppStore } from '../store';

interface ListingRecord {
  id: string;
  shopifyProductId: string;
  ebayListingId?: string | null;
  ebayInventoryItemId?: string | null;
  status: string;
  originalPrice?: number | null;
  lastRepublishedAt?: number | string | null;
  promotedAt?: number | string | null;
  adRate?: number | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  shopifyTitle?: string;
  shopifySku?: string;
}

const formatMoney = (value?: number | null) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '—';
  let date: Date;
  if (typeof value === 'number') {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    date = new Date(ms);
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const normalizeListing = (listing: any): ListingRecord => {
  const shopifyProductId =
    listing.shopifyProductId ?? listing.shopify_product_id ?? String(listing.shopifyProductID ?? listing.id ?? '');
  return {
    id: String(listing.id ?? shopifyProductId),
    shopifyProductId: String(shopifyProductId),
    ebayListingId: listing.ebayListingId ?? listing.ebay_listing_id ?? listing.ebayItemId ?? null,
    ebayInventoryItemId: listing.ebayInventoryItemId ?? listing.ebay_inventory_item_id ?? null,
    status: listing.status ?? 'inactive',
    originalPrice: listing.originalPrice ?? listing.original_price ?? listing.shopifyPrice ?? listing.shopify_price ?? listing.price ?? null,
    lastRepublishedAt: listing.lastRepublishedAt ?? listing.last_republished_at ?? null,
    promotedAt: listing.promotedAt ?? listing.promoted_at ?? null,
    adRate: listing.adRate ?? listing.ad_rate ?? null,
    createdAt: listing.createdAt ?? listing.created_at ?? null,
    updatedAt: listing.updatedAt ?? listing.updated_at ?? null,
    shopifyTitle: listing.shopifyTitle ?? listing.shopify_title,
    shopifySku: listing.shopifySku ?? listing.shopify_sku,
  };
};

const getStatusPresentation = (listing: ListingRecord) => {
  if (!listing.ebayListingId) {
    return { label: 'Missing', tone: 'critical' as const, dot: '#d72c0d' };
  }
  const normalized = listing.status.toLowerCase();
  if (normalized === 'active' || normalized === 'synced') {
    return { label: 'Active', tone: 'success' as const, dot: '#008060' };
  }
  if (normalized === 'error' || normalized === 'failed') {
    return { label: 'Error', tone: 'warning' as const, dot: '#b98900' };
  }
  if (normalized === 'inactive') {
    return { label: 'Inactive', tone: 'info' as const, dot: '#8c9196' };
  }
  if (normalized === 'pending') {
    return { label: 'Pending', tone: 'attention' as const, dot: '#0b62d6' };
  }
  return { label: listing.status || 'Unknown', tone: 'info' as const, dot: '#8c9196' };
};

const ListingDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  const { data: listingResponse, isLoading: listingLoading, error: listingError } = useListings({
    limit: 50,
    offset: 0,
    search: id,
  });

  const listing = useMemo(() => {
    const normalized = (listingResponse?.data ?? []).map(normalizeListing);
    return (
      normalized.find((item) => item.shopifyProductId === id || item.id === id) ??
      normalized[0] ??
      null
    );
  }, [listingResponse, id]);

  const { data: productInfo, isLoading: productLoading } = useQuery({
    queryKey: ['product-info', id],
    queryFn: () => apiClient.get<{ ok: boolean; product?: any }>(`/test/product-info/${id}`),
    enabled: Boolean(id),
  });

  const sku = productInfo?.product?.variant?.sku ?? listing?.shopifySku;
  const { data: ebayOffer, isLoading: ebayLoading } = useQuery({
    queryKey: ['ebay-offer', sku],
    queryFn: () => apiClient.get<{ ok: boolean; offer?: any; inventoryItem?: any }>(`/test/ebay-offer/${sku}`),
    enabled: Boolean(sku),
  });

  const { data: mappings } = useMappings();
  const { data: overridesResponse } = useProductOverrides(id);
  const saveOverrides = useSaveProductOverrides();

  // Track editable override values
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>({});
  const [overridesDirty, setOverridesDirty] = useState(false);
  const [overrideSaved, setOverrideSaved] = useState(false);

  // Resolve a Shopify field path like "variants[0].sku" against the product object
  const resolveShopifyField = useCallback((fieldPath: string, prod: any): string => {
    if (!prod || !fieldPath) return '';
    if (fieldPath.includes('[0].')) {
      const [base, nested] = fieldPath.split('[0].');
      return String(prod[base]?.[0]?.[nested] ?? '');
    }
    return String(prod[fieldPath] ?? '');
  }, []);

  // Resolve ALL mappings to their actual values, grouped by category
  // Each field gets: field_name, mapping_type, resolved value, display_order
  const resolvedFields = useMemo(() => {
    if (!mappings) return {} as Record<string, Array<{ field_name: string; mapping_type: string; resolved: string; display_order: number }>>;
    const grouped: Record<string, Array<{ field_name: string; mapping_type: string; resolved: string; display_order: number }>> = {};
    const categories = ['sales', 'listing', 'shipping', 'payment'] as const;
    const m = mappings as unknown as Record<string, any[]>;
    const prod = productInfo?.product;
    for (const cat of categories) {
      const fields = (m[cat] ?? [])
        .filter((item: any) => item.is_enabled !== false)
        .map((item: any) => {
          let resolved = '';
          switch (item.mapping_type) {
            case 'shopify_field':
              resolved = resolveShopifyField(item.source_value || '', prod);
              break;
            case 'constant':
              resolved = item.target_value || '';
              break;
            case 'formula':
              resolved = item.source_value || '';
              break;
            case 'edit_in_grid':
            default:
              resolved = '';
              break;
          }
          return { field_name: item.field_name, mapping_type: item.mapping_type, resolved, display_order: item.display_order };
        })
        .sort((a: any, b: any) => a.display_order - b.display_order);
      if (fields.length > 0) grouped[cat] = fields;
    }
    return grouped;
  }, [mappings, productInfo, resolveShopifyField]);

  // Initialize field values: override > resolved mapping > empty
  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const [cat, fields] of Object.entries(resolvedFields)) {
      for (const f of fields) {
        vals[`${cat}::${f.field_name}`] = f.resolved;
      }
    }
    if (overridesResponse?.data) {
      for (const o of overridesResponse.data) {
        if (o.value) vals[`${o.category}::${o.field_name}`] = o.value;
      }
    }
    setOverrideValues(vals);
    setOverridesDirty(false);
  }, [overridesResponse, resolvedFields]);

  const handleOverrideChange = useCallback((category: string, fieldName: string, value: string) => {
    const key = `${category}::${fieldName}`;
    setOverrideValues((prev) => ({ ...prev, [key]: value }));
    setOverridesDirty(true);
    setOverrideSaved(false);
  }, []);

  const handleSaveOverrides = useCallback(() => {
    if (!id) return;
    const overrides: Array<{ category: string; field_name: string; value: string }> = [];
    for (const [key, value] of Object.entries(overrideValues)) {
      if (value.trim() === '') continue;
      const [category, field_name] = key.split('::');
      overrides.push({ category, field_name, value });
    }
    saveOverrides.mutate(
      { shopifyProductId: id, overrides },
      {
        onSuccess: () => {
          setOverridesDirty(false);
          setOverrideSaved(true);
        },
      },
    );
  }, [id, overrideValues, saveOverrides]);

  const categoryLabels: Record<string, string> = {
    sales: 'Sales',
    listing: 'Listing',
    shipping: 'Shipping',
    payment: 'Payment',
  };

  const formatFieldLabel = (fieldName: string) =>
    fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const syncMutation = useMutation({
    mutationFn: () => apiClient.put(`/sync/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      addNotification({ type: 'success', title: 'Sync started', autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Sync failed', message: error instanceof Error ? error.message : 'Unknown error' });
    },
  });

  const endListingMutation = useMutation({
    mutationFn: () => apiClient.post(`/sync/products/${id}/end`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      addNotification({ type: 'success', title: 'Listing ended', autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Failed to end listing', message: error instanceof Error ? error.message : 'Unknown error' });
    },
  });

  const syncHistory = useMemo(() => {
    if (!listing) return [] as Array<{ label: string; value: string }>;
    const events = [
      { label: 'Created', value: formatTimestamp(listing.createdAt) },
      { label: 'Last updated', value: formatTimestamp(listing.updatedAt) },
      { label: 'Last republished', value: formatTimestamp(listing.lastRepublishedAt) },
      { label: 'Promoted', value: formatTimestamp(listing.promotedAt) },
    ];
    return events.filter((event) => event.value !== '—');
  }, [listing]);

  const product = productInfo?.product;
  const productVariant = product?.variant;
  const secondaryActions: Array<{ content: string; destructive?: boolean; onAction: () => void }> = [
    {
      content: 'End listing',
      destructive: true,
      onAction: () => endListingMutation.mutate(),
    },
  ];

  if (listing?.ebayListingId) {
    secondaryActions.push({
      content: 'View on eBay',
      onAction: () => {
        window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank');
      },
    });
  }

  return (
    <Page
      title={product?.title ?? listing?.shopifyTitle ?? 'Product detail'}
      subtitle={listing?.shopifyProductId ? `Shopify ID ${listing.shopifyProductId}` : undefined}
      backAction={{ content: 'Back to eBay listings', onAction: () => navigate('/ebay/listings') }}
      primaryAction={{
        content: 'Sync now',
        onAction: () => syncMutation.mutate(),
        loading: syncMutation.isPending,
      }}
      secondaryActions={secondaryActions}
    >
      {(listingLoading || productLoading) && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner accessibilityLabel="Loading product detail" size="large" />
        </div>
      )}

      {listingError && (
        <Banner tone="critical" title="Unable to load product detail">
          <p>{listingError instanceof Error ? listingError.message : 'Something went wrong.'}</p>
        </Banner>
      )}

      {listing && (
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" align="space-between">
                  <Text variant="headingMd" as="h2">Shopify product</Text>
                  {product?.status && <Badge tone="info">{product.status}</Badge>}
                </InlineStack>
                <InlineStack gap="400" align="start">
                  <BlockStack gap="200">
                    <Thumbnail
                      size="large"
                      source={product?.image?.src || product?.images?.[0]?.src || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
                      alt={product?.title ?? 'Product image'}
                    />
                    {product?.images && product.images.length > 1 && (
                      <InlineStack gap="100" wrap>
                        {product.images.slice(0, 6).map((img: any, idx: number) => (
                          <Thumbnail
                            key={img.id ?? idx}
                            size="small"
                            source={img.src}
                            alt={`${product?.title ?? 'Product'} image ${idx + 1}`}
                          />
                        ))}
                        {product.images.length > 6 && (
                          <Text variant="bodySm" tone="subdued" as="span">+{product.images.length - 6} more</Text>
                        )}
                      </InlineStack>
                    )}
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text variant="headingLg" as="h3">{product?.title ?? listing.shopifyTitle ?? 'Untitled product'}</Text>
                    <Text variant="bodyMd" tone="subdued" as="p">SKU: {productVariant?.sku ?? listing.shopifySku ?? '—'}</Text>
                    <Text variant="bodyMd" as="p">Price: {formatMoney(Number(productVariant?.price ?? listing.originalPrice ?? 0) || null)}</Text>
                    <Text variant="bodyMd" as="p">Inventory: {productVariant?.inventory_quantity ?? '—'}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Inventory Item ID: {productVariant?.inventory_item_id ?? listing.ebayInventoryItemId ?? '—'}</Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" align="space-between">
                  <Text variant="headingMd" as="h2">eBay listing</Text>
                  <Badge tone={getStatusPresentation(listing).tone}>{getStatusPresentation(listing).label}</Badge>
                </InlineStack>
                {ebayLoading ? (
                  <Spinner accessibilityLabel="Loading eBay details" size="small" />
                ) : (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">Listing ID: {listing.ebayListingId ?? '—'}</Text>
                    <Text variant="bodyMd" as="p">Offer ID: {ebayOffer?.offer?.offerId ?? '—'}</Text>
                    <Text variant="bodyMd" as="p">eBay price: {formatMoney(Number(ebayOffer?.offer?.price ?? 0) || null)}</Text>
                    <Text variant="bodyMd" as="p">Available: {ebayOffer?.offer?.quantity ?? ebayOffer?.inventoryItem?.quantity ?? '—'}</Text>
                    <Text variant="bodyMd" as="p">Category: {ebayOffer?.inventoryItem?.condition ?? '—'}</Text>
                  </BlockStack>
                )}
                <Divider />
                <InlineStack gap="200">
                  <Button
                    icon={<ExternalLink className="w-4 h-4" />}
                    onClick={() => listing.ebayListingId && window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
                    disabled={!listing.ebayListingId}
                  >
                    View on eBay
                  </Button>
                  <Button
                    icon={<ExternalLink className="w-4 h-4" />}
                    onClick={() => listing.ebayListingId && window.open(`https://www.ebay.com/sh/lst/active`, '_blank')}
                    disabled={!listing.ebayListingId}
                  >
                    Edit on eBay
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">eBay listing fields</Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      These are the values that will be sent to eBay. Edit any field to override the default mapping.
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    onClick={handleSaveOverrides}
                    loading={saveOverrides.isPending}
                    disabled={!overridesDirty}
                  >
                    Save changes
                  </Button>
                </InlineStack>
                {overrideSaved && (
                  <Banner tone="success" title="Changes saved successfully" onDismiss={() => setOverrideSaved(false)} />
                )}
                {Object.keys(resolvedFields).length === 0 ? (
                  <Text tone="subdued" as="p">No mapping data available. Configure mappings first.</Text>
                ) : (
                  Object.entries(resolvedFields).map(([category, fields]) => (
                    <BlockStack key={category} gap="300">
                      <InlineStack gap="200" align="start">
                        <Text variant="headingSm" as="h3">{categoryLabels[category] ?? category}</Text>
                        <Badge tone="info">{`${fields.length} fields`}</Badge>
                      </InlineStack>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                        {fields.map((field) => {
                          const key = `${category}::${field.field_name}`;
                          const currentValue = overrideValues[key] ?? '';
                          const isFromShopify = field.mapping_type === 'shopify_field' && field.resolved && currentValue === field.resolved;
                          const isConstant = field.mapping_type === 'constant' && currentValue === field.resolved;
                          const helpText = isFromShopify ? 'Auto-filled from Shopify' : isConstant ? 'Default value' : field.mapping_type === 'edit_in_grid' ? 'Manual entry' : undefined;
                          return (
                            <TextField
                              key={key}
                              label={formatFieldLabel(field.field_name)}
                              value={currentValue}
                              onChange={(value) => handleOverrideChange(category, field.field_name, value)}
                              autoComplete="off"
                              helpText={helpText}
                              labelAction={isFromShopify ? { content: 'Reset', onAction: () => handleOverrideChange(category, field.field_name, field.resolved) } : undefined}
                            />
                          );
                        })}
                      </div>
                      {category !== 'payment' && <Divider />}
                    </BlockStack>
                  ))
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Sync history</Text>
                {syncHistory.length === 0 ? (
                  <Text tone="subdued" as="p">No sync activity recorded yet.</Text>
                ) : (
                  <BlockStack gap="200">
                    {syncHistory.map((event) => (
                      <InlineStack key={event.label} align="space-between">
                        <Text variant="bodySm" tone="subdued" as="span">{event.label}</Text>
                        <Text variant="bodySm" as="span">{event.value}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      )}
    </Page>
  );
};

const Listings: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const syncProducts = useSyncProducts();

  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'missing' | 'error' | 'inactive' | 'pending'>('all');
  const [offset, setOffset] = useState(0);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const limit = 50;

  useEffect(() => {
    setOffset(0);
  }, [searchValue, statusFilter]);

  const statusParam = useMemo(() => {
    if (statusFilter === 'all' || statusFilter === 'missing') return undefined;
    if (statusFilter === 'active') return 'active,synced';
    return statusFilter;
  }, [statusFilter]);

  const { data, isLoading, error } = useListings({
    limit,
    offset,
    search: searchValue || undefined,
    status: statusParam,
  });

  const listings = useMemo(() => (data?.data ?? []).map(normalizeListing), [data]);
  const pageListings = useMemo(() => {
    if (statusFilter !== 'missing') return listings;
    return listings.filter((listing) => !listing.ebayListingId);
  }, [listings, statusFilter]);

  const total = data?.total ?? 0;

  const stats = useMemo(() => {
    const active = listings.filter((listing) => getStatusPresentation(listing).label === 'Active').length;
    const missing = listings.filter((listing) => !listing.ebayListingId).length;
    const errorCount = listings.filter((listing) => getStatusPresentation(listing).label === 'Error').length;
    return { active, missing, errorCount };
  }, [listings]);

  const selectedIdsOnPage = useMemo(() => pageListings.map((listing) => listing.shopifyProductId), [pageListings]);
  const allSelectedOnPage = selectedIdsOnPage.length > 0 && selectedIdsOnPage.every((id) => selectedItems.includes(id));

  const toggleSelectAll = useCallback((value: boolean) => {
    if (value) {
      setSelectedItems((prev) => Array.from(new Set([...prev, ...selectedIdsOnPage])));
      return;
    }
    setSelectedItems((prev) => prev.filter((id) => !selectedIdsOnPage.includes(id)));
  }, [selectedIdsOnPage]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const bulkEndMutation = useMutation({
    mutationFn: (productIds: string[]) =>
      Promise.all(productIds.map((productId) => apiClient.post(`/sync/products/${productId}/end`))),
    onSuccess: (_, productIds) => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      addNotification({ type: 'success', title: `${productIds.length} listings ended`, autoClose: 4000 });
      setSelectedItems([]);
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Bulk end failed', message: error instanceof Error ? error.message : 'Unknown error' });
    },
  });

  const bulkRelistMutation = useMutation({
    mutationFn: (productIds: string[]) =>
      Promise.all(productIds.map((productId) => apiClient.put(`/sync/products/${productId}`))),
    onSuccess: (_, productIds) => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      addNotification({ type: 'success', title: `${productIds.length} listings relisted`, autoClose: 4000 });
      setSelectedItems([]);
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Bulk relist failed', message: error instanceof Error ? error.message : 'Unknown error' });
    },
  });

  const rowMarkup = pageListings.map((listing, index) => {
    const status = getStatusPresentation(listing);
    const productLabel = listing.shopifyTitle ?? `Shopify product ${listing.shopifyProductId}`;
    return (
      <IndexTable.Row
        id={listing.shopifyProductId}
        key={listing.id}
        position={index}
        onClick={() => navigate(`/ebay/listings/${listing.shopifyProductId}`)}
      >
        <IndexTable.Cell>
          <div onClick={(event) => event.stopPropagation()}>
            <Checkbox
              label=""
              checked={selectedItems.includes(listing.shopifyProductId)}
              onChange={() => toggleSelection(listing.shopifyProductId)}
            />
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold" as="p">{productLabel}</Text>
            <Text variant="bodySm" tone="subdued" as="p">ID: {listing.shopifyProductId}</Text>
            {listing.shopifySku && <Text variant="bodySm" tone="subdued" as="p">SKU: {listing.shopifySku}</Text>}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text variant="bodyMd" as="p">{listing.ebayListingId ?? 'No listing linked'}</Text>
            <Text variant="bodySm" tone="subdued" as="p">Inventory ID: {listing.ebayInventoryItemId ?? '—'}</Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" align="start">
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: status.dot,
                marginTop: '6px',
              }}
            />
            <Badge tone={status.tone}>{status.label}</Badge>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="p">{formatMoney(listing.originalPrice ?? null)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodySm" tone="subdued" as="p">{formatTimestamp(listing.updatedAt)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div onClick={(event) => event.stopPropagation()}>
            <Button
              size="micro"
              icon={<ExternalLink className="w-3 h-3" />}
              onClick={() => listing.ebayListingId && window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
              disabled={!listing.ebayListingId}
            >
              View
            </Button>
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const pagination = (
    <Pagination
      hasPrevious={offset > 0}
      onPrevious={() => setOffset(Math.max(0, offset - limit))}
      hasNext={offset + limit < total}
      onNext={() => setOffset(offset + limit)}
    />
  );

  return (
    <Page
      title="Products & Listings"
      subtitle="Shopify catalog synced to eBay listings"
      primaryAction={{
        content: 'Sync all products',
        onAction: () => syncProducts.mutate([]),
        loading: syncProducts.isPending,
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" gap="300">
                <BlockStack gap="100">
                  <Text variant="headingLg" as="h2">Catalog snapshot</Text>
                  <Text variant="bodySm" tone="subdued" as="p">Real-time status for the current page of products.</Text>
                </BlockStack>
                <InlineStack gap="400">
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{stats.active}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Active</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{stats.missing}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Missing</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{stats.errorCount}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Errors</Text>
                  </BlockStack>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" align="space-between">
                <TextField
                  label=""
                  placeholder="Search by title, SKU, or eBay listing ID"
                  value={searchValue}
                  onChange={setSearchValue}
                  prefix={<Search className="w-4 h-4" />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                  autoComplete="off"
                />
                <InlineStack gap="200" wrap>
                  <Button pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</Button>
                  <Button pressed={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>Active</Button>
                  <Button pressed={statusFilter === 'missing'} onClick={() => setStatusFilter('missing')}>Missing</Button>
                  <Button pressed={statusFilter === 'error'} onClick={() => setStatusFilter('error')}>Errors</Button>
                  <Button pressed={statusFilter === 'inactive'} onClick={() => setStatusFilter('inactive')}>Inactive</Button>
                  <Button pressed={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')}>Pending</Button>
                </InlineStack>
              </InlineStack>

              {selectedItems.length > 0 && (
                <Card padding="200">
                  <InlineStack align="space-between" gap="300">
                    <Text variant="bodyMd" as="p">{selectedItems.length} selected</Text>
                    <ButtonGroup>
                      <Button
                        icon={<RotateCw className="w-4 h-4" />}
                        onClick={() => bulkRelistMutation.mutate(selectedItems)}
                        loading={bulkRelistMutation.isPending}
                      >
                        Bulk relist
                      </Button>
                      <Button
                        icon={<XCircle className="w-4 h-4" />}
                        tone="critical"
                        onClick={() => bulkEndMutation.mutate(selectedItems)}
                        loading={bulkEndMutation.isPending}
                      >
                        Bulk end
                      </Button>
                    </ButtonGroup>
                  </InlineStack>
                </Card>
              )}

              {error && (
                <Banner tone="critical" title="Unable to load listings">
                  <p>{error instanceof Error ? error.message : 'Something went wrong.'}</p>
                </Banner>
              )}

              <Divider />

              {isLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Spinner accessibilityLabel="Loading listings" size="large" />
                </div>
              ) : (
                <IndexTable
                  resourceName={{ singular: 'listing', plural: 'listings' }}
                  itemCount={pageListings.length}
                  headings={[
                    {
                      id: 'select',
                      title: (
                        <Checkbox
                          label=""
                          checked={allSelectedOnPage}
                          onChange={(value) => toggleSelectAll(Boolean(value))}
                        />
                      ),
                    },
                    { title: 'Product' },
                    { title: 'eBay listing' },
                    { title: 'Status' },
                    { title: 'Price' },
                    { title: 'Last updated' },
                    { title: 'Quick actions' },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="center">{pagination}</InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export { ListingDetail };
export default Listings;
