import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Box,
  Button,
  ButtonGroup,
  Card,
  Divider,
  IndexTable,
  InlineStack,
  InlineGrid,
  BlockStack,
  Layout,
  Page,
  Pagination,
  SkeletonBodyText,
  Text,
  TextField,
  Thumbnail,
  Spinner,
  Icon,
} from '@shopify/polaris';
import {
  ExternalIcon,
  RefreshIcon,
  SearchIcon,
  XCircleIcon,
  ProductIcon,
  StatusActiveIcon,
  AlertCircleIcon,
  ClockIcon,
  ViewIcon,
} from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, useListings, useMappings, useProductOverrides, useSaveProductOverrides, useSyncProducts } from '../hooks/useApi';
import { useAppStore } from '../store';

/* ────────────────── Types ────────────────── */

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

/* ────────────────── Helpers ────────────────── */

const formatMoney = (value?: number | null) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '—';
  const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : Date.parse(value);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
};

const formatTimestampFull = (value?: number | string | null) => {
  if (!value) return '—';
  const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : Date.parse(value);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString();
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

const isDraftListing = (ebayListingId?: string | null) =>
  Boolean(ebayListingId && ebayListingId.startsWith('draft-'));

const getStatusPresentation = (listing: ListingRecord) => {
  if (!listing.ebayListingId) {
    return { label: 'Missing', tone: 'critical' as const };
  }
  if (isDraftListing(listing.ebayListingId)) {
    return { label: 'Draft', tone: 'info' as const };
  }
  const normalized = listing.status.toLowerCase();
  if (normalized === 'active' || normalized === 'synced') return { label: 'Active', tone: 'success' as const };
  if (normalized === 'error' || normalized === 'failed') return { label: 'Error', tone: 'warning' as const };
  if (normalized === 'inactive') return { label: 'Inactive', tone: 'info' as const };
  if (normalized === 'pending') return { label: 'Pending', tone: 'attention' as const };
  return { label: listing.status || 'Unknown', tone: 'info' as const };
};

/* ────────────────── Stat Pill ────────────────── */

const StatPill: React.FC<{ label: string; value: number; icon: any; tone?: 'success' | 'critical' | 'warning' | 'info' }> = ({ label, value, icon, tone }) => (
  <Card>
    <InlineStack gap="300" blockAlign="center">
      <Box
        background={
          tone === 'success' ? 'bg-fill-success-secondary'
            : tone === 'critical' ? 'bg-fill-critical-secondary'
              : tone === 'warning' ? 'bg-fill-warning-secondary'
                : 'bg-fill-secondary'
        }
        borderRadius="200"
        padding="200"
      >
        <Icon source={icon} tone={tone ?? 'base'} />
      </Box>
      <BlockStack gap="050">
        <Text variant="headingMd" as="p">{value}</Text>
        <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
      </BlockStack>
    </InlineStack>
  </Card>
);

/* ────────────────── Listing Detail ────────────────── */

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
    return normalized.find((item) => item.shopifyProductId === id || item.id === id) ?? normalized[0] ?? null;
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

  const [overrideValues, setOverrideValues] = useState<Record<string, string>>({});
  const [overridesDirty, setOverridesDirty] = useState(false);
  const [overrideSaved, setOverrideSaved] = useState(false);

  const resolveShopifyField = useCallback((fieldPath: string, prod: any): string => {
    if (!prod || !fieldPath) return '';
    if (fieldPath.includes('[0].')) {
      const [base, nested] = fieldPath.split('[0].');
      return String(prod[base]?.[0]?.[nested] ?? '');
    }
    return String(prod[fieldPath] ?? '');
  }, []);

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
            case 'shopify_field': resolved = resolveShopifyField(item.source_value || '', prod); break;
            case 'constant': resolved = item.target_value || ''; break;
            case 'formula': resolved = item.source_value || ''; break;
            default: resolved = ''; break;
          }
          return { field_name: item.field_name, mapping_type: item.mapping_type, resolved, display_order: item.display_order };
        })
        .sort((a: any, b: any) => a.display_order - b.display_order);
      if (fields.length > 0) grouped[cat] = fields;
    }
    return grouped;
  }, [mappings, productInfo, resolveShopifyField]);

  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const [cat, fields] of Object.entries(resolvedFields)) {
      for (const f of fields) vals[`${cat}::${f.field_name}`] = f.resolved;
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
    setOverrideValues((prev) => ({ ...prev, [`${category}::${fieldName}`]: value }));
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
      { onSuccess: () => { setOverridesDirty(false); setOverrideSaved(true); } },
    );
  }, [id, overrideValues, saveOverrides]);

  const categoryLabels: Record<string, string> = { sales: 'Sales', listing: 'Listing', shipping: 'Shipping', payment: 'Payment' };
  const formatFieldLabel = (fieldName: string) => fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
    if (!listing) return [];
    return [
      { label: 'Created', value: formatTimestampFull(listing.createdAt) },
      { label: 'Last updated', value: formatTimestampFull(listing.updatedAt) },
      { label: 'Last republished', value: formatTimestampFull(listing.lastRepublishedAt) },
      { label: 'Promoted', value: formatTimestampFull(listing.promotedAt) },
    ].filter((event) => event.value !== '—');
  }, [listing]);

  const product = productInfo?.product;
  const productVariant = product?.variant;

  const secondaryActions: Array<{ content: string; destructive?: boolean; onAction: () => void }> = [
    { content: 'End listing', destructive: true, onAction: () => endListingMutation.mutate() },
  ];
  if (listing?.ebayListingId && !isDraftListing(listing.ebayListingId)) {
    secondaryActions.push({
      content: 'View on eBay',
      onAction: () => window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank'),
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
      fullWidth
    >
      {(listingLoading || productLoading) && (
        <Box padding="800">
          <InlineStack align="center">
            <Spinner accessibilityLabel="Loading product detail" size="large" />
          </InlineStack>
        </Box>
      )}

      {listingError && (
        <Banner tone="critical" title="Unable to load product detail">
          <Text as="p">{listingError instanceof Error ? listingError.message : 'Something went wrong.'}</Text>
        </Banner>
      )}

      {listing && (
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="300" align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                        <Icon source={ProductIcon} />
                      </Box>
                      <Text variant="headingMd" as="h2">Shopify product</Text>
                    </InlineStack>
                    {product?.status && <Badge tone="info">{product.status}</Badge>}
                  </InlineStack>
                  <Divider />
                  <InlineStack gap="400" align="start">
                    <BlockStack gap="200">
                      <Thumbnail
                        size="large"
                        source={product?.image?.src || product?.images?.[0]?.src || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png'}
                        alt={product?.title ?? 'Product image'}
                      />
                      {product?.images && product.images.length > 1 && (
                        <InlineStack gap="100" wrap>
                          {product.images.slice(0, 6).map((img: any, idx: number) => (
                            <Thumbnail key={img.id ?? idx} size="small" source={img.src} alt={`Image ${idx + 1}`} />
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
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="300" align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                        <Icon source={ViewIcon} />
                      </Box>
                      <Text variant="headingMd" as="h2">eBay listing</Text>
                    </InlineStack>
                    <Badge tone={getStatusPresentation(listing).tone}>{getStatusPresentation(listing).label}</Badge>
                  </InlineStack>
                  <Divider />
                  {ebayLoading ? (
                    <Spinner accessibilityLabel="Loading eBay details" size="small" />
                  ) : (
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">Listing ID</Text>
                        <Text variant="bodyMd" as="p">{listing.ebayListingId ?? '—'}</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">Offer ID</Text>
                        <Text variant="bodyMd" as="p">{ebayOffer?.offer?.offerId ?? '—'}</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">eBay price</Text>
                        <Text variant="bodyMd" as="p">{formatMoney(Number(ebayOffer?.offer?.price ?? 0) || null)}</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">Available</Text>
                        <Text variant="bodyMd" as="p">{ebayOffer?.offer?.quantity ?? ebayOffer?.inventoryItem?.quantity ?? '—'}</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">Condition</Text>
                        <Text variant="bodyMd" as="p">{ebayOffer?.inventoryItem?.condition ?? '—'}</Text>
                      </BlockStack>
                    </InlineGrid>
                  )}
                  <Divider />
                  <InlineStack gap="200">
                    {isDraftListing(listing.ebayListingId) ? (
                      <Badge tone="info">Draft — not yet published</Badge>
                    ) : (
                      <>
                        <Button
                          icon={ExternalIcon}
                          onClick={() => listing.ebayListingId && window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
                          disabled={!listing.ebayListingId}
                        >
                          View on eBay
                        </Button>
                        <Button
                          icon={ExternalIcon}
                          onClick={() => window.open(`https://www.ebay.com/sh/lst/active?q=${encodeURIComponent(listing.shopifySku || '')}`, '_blank')}
                          disabled={!listing.ebayListingId}
                        >
                          Edit on eBay
                        </Button>
                      </>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="headingMd" as="h2">eBay listing fields</Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        Values sent to eBay. Edit any field to override the default mapping.
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
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="headingSm" as="h3">{categoryLabels[category] ?? category}</Text>
                          <Badge tone="info">{`${fields.length} fields`}</Badge>
                        </InlineStack>
                        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
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
                        </InlineGrid>
                        {category !== 'payment' && <Divider />}
                      </BlockStack>
                    ))
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                      <Icon source={ClockIcon} />
                    </Box>
                    <Text variant="headingMd" as="h2">Sync history</Text>
                  </InlineStack>
                  <Divider />
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
        </BlockStack>
      )}
    </Page>
  );
};

/* ────────────────── Listings List ────────────────── */

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

  useEffect(() => { setOffset(0); }, [searchValue, statusFilter]);

  const statusParam = useMemo(() => {
    if (statusFilter === 'all' || statusFilter === 'missing') return undefined;
    if (statusFilter === 'active') return 'active,synced';
    return statusFilter;
  }, [statusFilter]);

  const { data, isLoading, error } = useListings({ limit, offset, search: searchValue || undefined, status: statusParam });
  const listings = useMemo(() => (data?.data ?? []).map(normalizeListing), [data]);
  const pageListings = useMemo(() => {
    if (statusFilter !== 'missing') return listings;
    return listings.filter((l) => !l.ebayListingId);
  }, [listings, statusFilter]);
  const total = data?.total ?? 0;

  const stats = useMemo(() => {
    const active = listings.filter((l) => getStatusPresentation(l).label === 'Active').length;
    const missing = listings.filter((l) => !l.ebayListingId).length;
    const errorCount = listings.filter((l) => getStatusPresentation(l).label === 'Error').length;
    const draft = listings.filter((l) => getStatusPresentation(l).label === 'Draft').length;
    return { active, missing, errorCount, draft };
  }, [listings]);

  const selectedIdsOnPage = useMemo(() => pageListings.map((l) => l.shopifyProductId), [pageListings]);
  const allSelectedOnPage = selectedIdsOnPage.length > 0 && selectedIdsOnPage.every((id) => selectedItems.includes(id));

  const toggleSelectAll = useCallback((value: boolean) => {
    if (value) {
      setSelectedItems((prev) => Array.from(new Set([...prev, ...selectedIdsOnPage])));
    } else {
      setSelectedItems((prev) => prev.filter((id) => !selectedIdsOnPage.includes(id)));
    }
  }, [selectedIdsOnPage]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedItems((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }, []);

  const bulkEndMutation = useMutation({
    mutationFn: (productIds: string[]) => Promise.all(productIds.map((pid) => apiClient.post(`/sync/products/${pid}/end`))),
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
    mutationFn: (productIds: string[]) => Promise.all(productIds.map((pid) => apiClient.put(`/sync/products/${pid}`))),
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
    const draft = isDraftListing(listing.ebayListingId);
    return (
      <IndexTable.Row
        id={listing.shopifyProductId}
        key={listing.id}
        position={index}
        selected={selectedItems.includes(listing.shopifyProductId)}
        onClick={() => navigate(`/ebay/listings/${listing.shopifyProductId}`)}
      >
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold" as="p">{productLabel}</Text>
            {listing.shopifySku && <Text variant="bodySm" tone="subdued" as="p">SKU: {listing.shopifySku}</Text>}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text variant="bodyMd" as="p">{listing.ebayListingId ?? 'No listing linked'}</Text>
            <Text variant="bodySm" tone="subdued" as="p">Inv: {listing.ebayInventoryItemId ?? '—'}</Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={status.tone}>{status.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="p">{formatMoney(listing.originalPrice ?? null)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodySm" tone="subdued" as="p">{formatTimestamp(listing.updatedAt)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {draft ? (
            <Badge tone="info">Draft</Badge>
          ) : (
            <Button
              size="micro"
              icon={ExternalIcon}
              onClick={() => listing.ebayListingId && window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
              disabled={!listing.ebayListingId}
            >
              View
            </Button>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Products & Listings"
      subtitle="Shopify catalog synced to eBay listings"
      primaryAction={{
        content: 'Sync all products',
        onAction: () => syncProducts.mutate([]),
        loading: syncProducts.isPending,
      }}
      fullWidth
    >
      <BlockStack gap="500">
        {/* Stats row */}
        <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
          <StatPill label="Active" value={stats.active} icon={StatusActiveIcon} tone="success" />
          <StatPill label="Missing" value={stats.missing} icon={AlertCircleIcon} tone="critical" />
          <StatPill label="Draft" value={stats.draft} icon={ClockIcon} tone="info" />
          <StatPill label="Errors" value={stats.errorCount} icon={AlertCircleIcon} tone="warning" />
        </InlineGrid>

        {/* Table card */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="space-between" blockAlign="end">
              <Box minWidth="280px">
                <TextField
                  label="Search"
                  labelHidden
                  placeholder="Search by title, SKU, or eBay listing ID"
                  value={searchValue}
                  onChange={setSearchValue}
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                  autoComplete="off"
                />
              </Box>
              <InlineStack gap="200" wrap>
                {(['all', 'active', 'missing', 'error', 'inactive', 'pending'] as const).map((f) => (
                  <Button key={f} pressed={statusFilter === f} onClick={() => setStatusFilter(f)}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Button>
                ))}
              </InlineStack>
            </InlineStack>

            {selectedItems.length > 0 && (
              <Card padding="200">
                <InlineStack align="space-between" gap="300" blockAlign="center">
                  <Text variant="bodyMd" as="p" fontWeight="medium">{selectedItems.length} selected</Text>
                  <ButtonGroup>
                    <Button icon={RefreshIcon} onClick={() => bulkRelistMutation.mutate(selectedItems)} loading={bulkRelistMutation.isPending}>
                      Bulk relist
                    </Button>
                    <Button icon={XCircleIcon} tone="critical" onClick={() => bulkEndMutation.mutate(selectedItems)} loading={bulkEndMutation.isPending}>
                      Bulk end
                    </Button>
                  </ButtonGroup>
                </InlineStack>
              </Card>
            )}

            {error && (
              <Banner tone="critical" title="Unable to load listings">
                <Text as="p">{error instanceof Error ? error.message : 'Something went wrong.'}</Text>
              </Banner>
            )}

            <Divider />

            {isLoading ? (
              <Box padding="800">
                <InlineStack align="center">
                  <Spinner accessibilityLabel="Loading listings" size="large" />
                </InlineStack>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: 'listing', plural: 'listings' }}
                itemCount={pageListings.length}
                selectedItemsCount={selectedItems.length}
                onSelectionChange={(selectionType, _toggleType, id) => {
                  if (selectionType === 'all') {
                    toggleSelectAll(!allSelectedOnPage);
                  } else if (id && typeof id === 'string') {
                    toggleSelection(id);
                  }
                }}
                headings={[
                  { title: 'Product' },
                  { title: 'eBay listing' },
                  { title: 'Status' },
                  { title: 'Price' },
                  { title: 'Last updated' },
                  { title: 'Actions' },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <InlineStack align="center">
          <Pagination
            hasPrevious={offset > 0}
            onPrevious={() => setOffset(Math.max(0, offset - limit))}
            hasNext={offset + limit < total}
            onNext={() => setOffset(offset + limit)}
          />
        </InlineStack>
      </BlockStack>
    </Page>
  );
};

export { ListingDetail };
export default Listings;
