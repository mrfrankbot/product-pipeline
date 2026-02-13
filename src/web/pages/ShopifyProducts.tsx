import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  IndexTable,
  InlineStack,
  BlockStack,
  Layout,
  Page,
  Pagination,
  Spinner,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris';
import { ExternalLink, Image, Search, Sparkles } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, useListings } from '../hooks/useApi';
import { useAppStore } from '../store';

/* ────────────────────────── helpers ────────────────────────── */

const PLACEHOLDER_IMG =
  'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';

const formatMoney = (value?: number | null) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

interface NormalizedListing {
  id: string;
  shopifyProductId: string;
  ebayListingId?: string | null;
  status: string;
  originalPrice?: number | null;
  shopifyTitle?: string;
  shopifySku?: string;
}

const normalizeListing = (listing: any): NormalizedListing => {
  const shopifyProductId =
    listing.shopifyProductId ?? listing.shopify_product_id ?? String(listing.shopifyProductID ?? listing.id ?? '');
  return {
    id: String(listing.id ?? shopifyProductId),
    shopifyProductId: String(shopifyProductId),
    ebayListingId: listing.ebayListingId ?? listing.ebay_listing_id ?? listing.ebayItemId ?? null,
    status: listing.status ?? 'inactive',
    originalPrice:
      listing.originalPrice ?? listing.original_price ?? listing.shopifyPrice ?? listing.shopify_price ?? listing.price ?? null,
    shopifyTitle: listing.shopifyTitle ?? listing.shopify_title,
    shopifySku: listing.shopifySku ?? listing.shopify_sku,
  };
};

/* ──────────────────── ShopifyProductDetail ──────────────────── */

export const ShopifyProductDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  /* Fetch Shopify product data */
  const { data: productInfo, isLoading: productLoading } = useQuery({
    queryKey: ['product-info', id],
    queryFn: () => apiClient.get<{ ok: boolean; product?: any }>(`/test/product-info/${id}`),
    enabled: Boolean(id),
  });

  /* Fetch listing record to check eBay link */
  const { data: listingResponse } = useListings({ limit: 50, offset: 0, search: id });
  const listing = useMemo(() => {
    const normalized = (listingResponse?.data ?? []).map(normalizeListing);
    return normalized.find((item) => item.shopifyProductId === id || item.id === id) ?? normalized[0] ?? null;
  }, [listingResponse, id]);

  const product = productInfo?.product;
  const variant = product?.variant ?? product?.variants?.[0];
  const images: Array<{ id: number; src: string }> = product?.images ?? [];
  const mainImage = product?.image?.src ?? images[0]?.src ?? PLACEHOLDER_IMG;

  /* ── AI regeneration ── */
  const aiMutation = useMutation({
    mutationFn: () => apiClient.post(`/auto-list/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-info', id] });
      addNotification({ type: 'success', title: 'AI description generated', autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'AI generation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  /* ── PhotoRoom image processing ── */
  const photoRoomMutation = useMutation({
    mutationFn: () => apiClient.post(`/images/process/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-info', id] });
      addNotification({ type: 'success', title: 'Images processed with PhotoRoom', autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'PhotoRoom processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const statusBadge = product?.status ? (
    <Badge tone={product.status === 'active' ? 'success' : product.status === 'draft' ? 'info' : 'warning'}>
      {product.status}
    </Badge>
  ) : null;

  return (
    <Page
      title={product?.title ?? 'Loading product…'}
      subtitle={id ? `Shopify ID ${id}` : undefined}
      backAction={{ content: 'Products', onAction: () => navigate('/listings') }}
      primaryAction={{
        content: 'Regenerate AI Description',
        onAction: () => aiMutation.mutate(),
        loading: aiMutation.isPending,
      }}
      secondaryActions={[
        {
          content: 'Process images (PhotoRoom)',
          onAction: () => photoRoomMutation.mutate(),
          loading: photoRoomMutation.isPending,
        },
      ]}
    >
      {productLoading && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner accessibilityLabel="Loading product" size="large" />
        </div>
      )}

      {product && (
        <Layout>
          {/* ── Images ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Images</Text>
                  <Button
                    icon={<Image className="w-4 h-4" />}
                    onClick={() => photoRoomMutation.mutate()}
                    loading={photoRoomMutation.isPending}
                  >
                    Process with PhotoRoom
                  </Button>
                </InlineStack>
                <InlineStack gap="400" align="start" wrap>
                  {images.length > 0 ? (
                    images.map((img) => (
                      <div key={img.id} style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden' }}>
                        <img
                          src={img.src}
                          alt={product.title}
                          style={{ width: '160px', height: '160px', objectFit: 'cover', display: 'block' }}
                        />
                      </div>
                    ))
                  ) : (
                    <Thumbnail size="large" source={PLACEHOLDER_IMG} alt="No images" />
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Description ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Description</Text>
                  <Button
                    icon={<Sparkles className="w-4 h-4" />}
                    onClick={() => aiMutation.mutate()}
                    loading={aiMutation.isPending}
                  >
                    Regenerate with AI
                  </Button>
                </InlineStack>
                {product.body_html ? (
                  <div
                    style={{ maxHeight: '300px', overflow: 'auto', padding: '8px', background: '#fafafa', borderRadius: '6px' }}
                    dangerouslySetInnerHTML={{ __html: product.body_html }}
                  />
                ) : (
                  <Text tone="subdued" as="p">No description available. Click &ldquo;Regenerate with AI&rdquo; to generate one.</Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Product Details ── */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Details</Text>
                  {statusBadge}
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">SKU</Text>
                  <Text variant="bodyMd" as="span">{variant?.sku ?? '—'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Price</Text>
                  <Text variant="bodyMd" as="span">{formatMoney(Number(variant?.price) || null)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Compare-at price</Text>
                  <Text variant="bodyMd" as="span">{formatMoney(Number(variant?.compare_at_price) || null)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Inventory</Text>
                  <Text variant="bodyMd" as="span">{variant?.inventory_quantity ?? '—'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Product type</Text>
                  <Text variant="bodyMd" as="span">{product.product_type || '—'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Vendor</Text>
                  <Text variant="bodyMd" as="span">{product.vendor || '—'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Tags</Text>
                  <Text variant="bodyMd" as="span">{product.tags || '—'}</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── eBay Link ── */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">eBay Listing</Text>
                <Divider />
                {listing?.ebayListingId ? (
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" tone="subdued" as="span">eBay Item ID</Text>
                      <Text variant="bodyMd" as="span">{listing.ebayListingId}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" tone="subdued" as="span">Status</Text>
                      <Badge tone={listing.status === 'active' || listing.status === 'synced' ? 'success' : 'info'}>
                        {listing.status}
                      </Badge>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Button
                        icon={<ExternalLink className="w-4 h-4" />}
                        onClick={() => window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
                      >
                        View on eBay
                      </Button>
                      <Button onClick={() => navigate(`/ebay/listings/${listing.shopifyProductId}`)}>
                        Listing detail
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <Text tone="subdued" as="p">No eBay listing linked to this product.</Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      )}
    </Page>
  );
};

/* ──────────────────── ShopifyProducts (list) ──────────────────── */

const ShopifyProducts: React.FC = () => {
  const navigate = useNavigate();

  const [searchValue, setSearchValue] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  useEffect(() => {
    setOffset(0);
  }, [searchValue]);

  const { data, isLoading, error } = useListings({
    limit,
    offset,
    search: searchValue || undefined,
  });

  const listings = useMemo(() => (data?.data ?? []).map(normalizeListing), [data]);
  const total = data?.total ?? 0;

  const rowMarkup = listings.map((listing, index) => {
    const hasEbay = Boolean(listing.ebayListingId);
    return (
      <IndexTable.Row
        id={listing.shopifyProductId}
        key={listing.id}
        position={index}
        onClick={() => navigate(`/listings/${listing.shopifyProductId}`)}
      >
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold" as="p">
              {listing.shopifyTitle ?? `Product ${listing.shopifyProductId}`}
            </Text>
            {listing.shopifySku && (
              <Text variant="bodySm" tone="subdued" as="p">SKU: {listing.shopifySku}</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="p">{formatMoney(listing.originalPrice ?? null)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {hasEbay ? (
            <Badge tone="success">Listed</Badge>
          ) : (
            <Badge tone="info">Not listed</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodySm" tone="subdued" as="p">{listing.shopifyProductId}</Text>
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
    <Page title="Shopify Products" subtitle="Manage product descriptions, images, and AI generation">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <TextField
                label=""
                placeholder="Search products by title or SKU…"
                value={searchValue}
                onChange={setSearchValue}
                prefix={<Search className="w-4 h-4" />}
                clearButton
                onClearButtonClick={() => setSearchValue('')}
                autoComplete="off"
              />

              <Divider />

              {error && (
                <Banner tone="critical" title="Unable to load products">
                  <p>{error instanceof Error ? error.message : 'Something went wrong.'}</p>
                </Banner>
              )}

              {isLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Spinner accessibilityLabel="Loading products" size="large" />
                </div>
              ) : (
                <IndexTable
                  resourceName={{ singular: 'product', plural: 'products' }}
                  itemCount={listings.length}
                  headings={[
                    { title: 'Product' },
                    { title: 'Price' },
                    { title: 'eBay status' },
                    { title: 'Shopify ID' },
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

export default ShopifyProducts;
