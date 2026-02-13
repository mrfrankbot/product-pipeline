import React, { useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Divider,
  IndexTable,
  InlineStack,
  BlockStack,
  Layout,
  Page,
  Pagination,
  Select,
  Spinner,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris';
import { ExternalLink, Filter, Play, Search, SortAsc, SortDesc } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, useListings } from '../hooks/useApi';
import { useAppStore } from '../store';

/* ────────────────────────── helpers ────────────────────────── */

const PLACEHOLDER_IMG =
  'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';

const formatMoney = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '—';
  const numberValue = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numberValue)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numberValue);
};

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '—';
  const ms = typeof value === 'number' ? (value > 1_000_000_000_000 ? value : value * 1000) : Date.parse(value);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString();
};

const getShopifyStatusBadge = (status?: string | null) => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'active') return <Badge tone="success">active</Badge>;
  if (normalized === 'draft') return <Badge tone="info">draft</Badge>;
  if (normalized === 'archived') return <Badge tone="warning">archived</Badge>;
  return <Badge>{status || 'unknown'}</Badge>;
};

const getEbayBadge = (status: string) => {
  if (status === 'listed') return <Badge tone="success">Listed</Badge>;
  if (status === 'draft') return <Badge tone="info">Draft</Badge>;
  return <Badge>Not listed</Badge>;
};

const getBinaryBadge = (value: boolean) =>
  value ? <Badge tone="success">✅ Done</Badge> : <Badge>❌ Not yet</Badge>;

interface ProductOverview {
  shopifyProductId: string;
  title: string;
  sku: string;
  price: string;
  shopifyStatus: string;
  imageUrl?: string | null;
  imageCount: number;
  hasAiDescription: boolean;
  hasProcessedImages: boolean;
  ebayStatus: 'listed' | 'draft' | 'not_listed';
  ebayListingId?: string | null;
  pipelineJobId?: string | null;
}

interface ProductsOverviewResponse {
  products: ProductOverview[];
  summary: {
    total: number;
    withDescriptions: number;
    withProcessedImages: number;
    listedOnEbay: number;
    draftOnEbay: number;
  };
}

/* ──────────────────── ShopifyProductDetail ──────────────────── */

export const ShopifyProductDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addNotification } = useAppStore();
  const [processedImages, setProcessedImages] = useState<string[]>([]);

  const { data: productInfo, isLoading: productLoading } = useQuery({
    queryKey: ['product-info', id],
    queryFn: () => apiClient.get<{ ok: boolean; product?: any }>(`/test/product-info/${id}`),
    enabled: Boolean(id),
  });

  const { data: pipelineStatus } = useQuery({
    queryKey: ['product-pipeline-status', id],
    queryFn: () => apiClient.get<{ ok: boolean; status?: any }>(`/products/${id}/pipeline-status`),
    enabled: Boolean(id),
    retry: 1,
  });

  const { data: pipelineJobs } = useQuery({
    queryKey: ['pipeline-jobs', id],
    queryFn: () => apiClient.get<{ jobs: any[] }>(`/pipeline/jobs?productId=${id}&limit=1`),
    enabled: Boolean(id),
    refetchInterval: 10000,
  });

  const { data: listingResponse } = useListings({ limit: 50, offset: 0, search: id });
  const listing = useMemo(() => {
    const normalized = (listingResponse?.data ?? []).map((item: any) => ({
      shopifyProductId: String(item.shopifyProductId ?? item.shopify_product_id ?? item.shopifyProductID ?? item.id ?? ''),
      ebayListingId: item.ebayListingId ?? item.ebay_listing_id ?? item.ebayItemId ?? null,
      status: item.status ?? 'inactive',
    }));
    return normalized.find((item) => item.shopifyProductId === id) ?? normalized[0] ?? null;
  }, [listingResponse, id]);

  const product = productInfo?.product;
  const variant = product?.variant ?? product?.variants?.[0];
  const images: Array<{ id: number; src: string }> = product?.images ?? [];
  const mainImage = product?.image?.src ?? images[0]?.src ?? PLACEHOLDER_IMG;

  const pipelineJob = pipelineJobs?.jobs?.[0];
  const pipelineSteps = pipelineJob?.steps ?? [];
  const aiDescription = pipelineStatus?.status?.ai_description ?? null;

  const runPipelineMutation = useMutation({
    mutationFn: () => apiClient.post(`/auto-list/${id}`),
    onSuccess: (result: any) => {
      addNotification({ type: 'success', title: 'Pipeline started', message: result?.message ?? undefined, autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Pipeline failed to start',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const aiMutation = useMutation({
    mutationFn: () => apiClient.post(`/auto-list/${id}`),
    onSuccess: () => {
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

  const photoRoomMutation = useMutation({
    mutationFn: () => apiClient.post<{ images?: string[] }>(`/images/process/${id}`),
    onSuccess: (data) => {
      setProcessedImages(data?.images ?? []);
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

  const statusBadge = product?.status ? getShopifyStatusBadge(product.status) : null;

  return (
    <Page
      title={product?.title ?? 'Loading product…'}
      subtitle={id ? `Shopify ID ${id}` : undefined}
      backAction={{ content: 'Products', onAction: () => navigate('/listings') }}
      primaryAction={{
        content: 'Run Pipeline',
        onAction: () => runPipelineMutation.mutate(),
        loading: runPipelineMutation.isPending,
      }}
      secondaryActions={[
        {
          content: 'Regenerate AI Description',
          onAction: () => aiMutation.mutate(),
          loading: aiMutation.isPending,
        },
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
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Pipeline progress</Text>
                  {pipelineJob?.status && <Badge>{pipelineJob.status}</Badge>}
                </InlineStack>
                {pipelineSteps.length === 0 ? (
                  <Text tone="subdued" as="p">No pipeline runs yet for this product.</Text>
                ) : (
                  <BlockStack gap="200">
                    {pipelineSteps.map((step: any) => (
                      <InlineStack key={step.name} align="space-between" blockAlign="center">
                        <Text as="span">{step.name.replace(/_/g, ' ')}</Text>
                        <Badge tone={step.status === 'done' ? 'success' : step.status === 'error' ? 'critical' : step.status === 'running' ? 'attention' : 'info'}>
                          {step.status}
                        </Badge>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Images with before/after ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Images</Text>
                  <Button
                    icon={<Play className="w-4 h-4" />}
                    onClick={() => photoRoomMutation.mutate()}
                    loading={photoRoomMutation.isPending}
                  >
                    Process with PhotoRoom
                  </Button>
                </InlineStack>
                <InlineStack gap="400" align="start" wrap>
                  {(images.length > 0 ? images : [{ id: 0, src: mainImage }]).map((img, idx) => (
                    <Card key={img.id ?? idx} padding="200">
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued" as="p">Original</Text>
                        <img
                          src={img.src}
                          alt={product.title}
                          style={{ width: '180px', height: '180px', objectFit: 'cover', borderRadius: '8px' }}
                        />
                        <Text variant="bodySm" tone="subdued" as="p">PhotoRoom</Text>
                        {processedImages[idx] ? (
                          <img
                            src={processedImages[idx]}
                            alt="Processed"
                            style={{ width: '180px', height: '180px', objectFit: 'cover', borderRadius: '8px' }}
                          />
                        ) : (
                          <Text tone="subdued" as="p">Not processed yet</Text>
                        )}
                      </BlockStack>
                    </Card>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Description ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">AI Description</Text>
                  <Button
                    icon={<Play className="w-4 h-4" />}
                    onClick={() => aiMutation.mutate()}
                    loading={aiMutation.isPending}
                  >
                    Regenerate with AI
                  </Button>
                </InlineStack>
                {aiDescription ? (
                  <BlockStack gap="200">
                    <Badge tone="success">AI-generated</Badge>
                    <div
                      style={{ maxHeight: '300px', overflow: 'auto', padding: '8px', background: '#fafafa', borderRadius: '6px', whiteSpace: 'pre-wrap' }}
                    >
                      {aiDescription}
                    </div>
                  </BlockStack>
                ) : product.body_html ? (
                  <div
                    style={{ maxHeight: '300px', overflow: 'auto', padding: '8px', background: '#fafafa', borderRadius: '6px' }}
                    dangerouslySetInnerHTML={{ __html: product.body_html }}
                  />
                ) : (
                  <Text tone="subdued" as="p">No AI description yet. Click “Regenerate with AI” to generate one.</Text>
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
                  <Text variant="bodyMd" as="span">{formatMoney(variant?.price ?? null)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued" as="span">Compare-at price</Text>
                  <Text variant="bodyMd" as="span">{formatMoney(variant?.compare_at_price ?? null)}</Text>
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
                      {listing.ebayListingId.startsWith('draft-') ? (
                        <Badge tone="info">Draft — not yet published</Badge>
                      ) : (
                        <Badge tone={listing.status === 'active' || listing.status === 'synced' ? 'success' : 'info'}>
                          {listing.status}
                        </Badge>
                      )}
                    </InlineStack>
                    <InlineStack gap="200">
                      {!listing.ebayListingId.startsWith('draft-') && (
                        <Button
                          icon={<ExternalLink className="w-4 h-4" />}
                          onClick={() => window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
                        >
                          View on eBay
                        </Button>
                      )}
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
  const { addNotification } = useAppStore();

  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data, isLoading, error } = useQuery({
    queryKey: ['products-overview'],
    queryFn: () => apiClient.get<ProductsOverviewResponse>('/products/overview'),
    refetchInterval: 30000,
  });

  const runPipelineMutation = useMutation({
    mutationFn: (productId: string) => apiClient.post(`/auto-list/${productId}`),
    onSuccess: (_result, productId) => {
      addNotification({ type: 'success', title: 'Pipeline started', message: `Product ${productId}` });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Pipeline failed to start', message: error instanceof Error ? error.message : 'Unknown error' });
    },
  });

  const products = data?.products ?? [];

  const filtered = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    return products.filter((product) => {
      const matchesQuery =
        !query ||
        product.title.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query);

      if (!matchesQuery) return false;

      switch (statusFilter) {
        case 'ready':
          return product.hasAiDescription && product.hasProcessedImages && product.ebayStatus === 'not_listed';
        case 'needs_description':
          return !product.hasAiDescription;
        case 'needs_images':
          return !product.hasProcessedImages;
        case 'listed':
          return product.ebayStatus === 'listed' || product.ebayStatus === 'draft';
        case 'not_listed':
          return product.ebayStatus === 'not_listed';
        default:
          return true;
      }
    });
  }, [products, searchValue, statusFilter]);

  const sorted = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    const rank = { active: 1, draft: 2, archived: 3 } as Record<string, number>;
    const ebayRank = { listed: 1, draft: 2, not_listed: 3 } as Record<string, number>;

    return [...filtered].sort((a, b) => {
      let left: string | number = '';
      let right: string | number = '';

      switch (sortKey) {
        case 'sku':
          left = a.sku || '';
          right = b.sku || '';
          break;
        case 'price':
          left = Number(a.price || 0);
          right = Number(b.price || 0);
          break;
        case 'shopifyStatus':
          left = rank[a.shopifyStatus] ?? 99;
          right = rank[b.shopifyStatus] ?? 99;
          break;
        case 'ai':
          left = a.hasAiDescription ? 1 : 0;
          right = b.hasAiDescription ? 1 : 0;
          break;
        case 'images':
          left = a.hasProcessedImages ? 1 : 0;
          right = b.hasProcessedImages ? 1 : 0;
          break;
        case 'ebayStatus':
          left = ebayRank[a.ebayStatus] ?? 99;
          right = ebayRank[b.ebayStatus] ?? 99;
          break;
        default:
          left = a.title.toLowerCase();
          right = b.title.toLowerCase();
      }

      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
      return 0;
    });
  }, [filtered, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const summary = data?.summary ?? {
    total: 0,
    withDescriptions: 0,
    withProcessedImages: 0,
    listedOnEbay: 0,
    draftOnEbay: 0,
  };

  const rowMarkup = pageItems.map((product, index) => {
    const canViewEbay = Boolean(product.ebayListingId && !product.ebayListingId.startsWith('draft-'));
    return (
      <IndexTable.Row
        id={product.shopifyProductId}
        key={product.shopifyProductId}
        position={index}
        onClick={() => navigate(`/listings/${product.shopifyProductId}`)}
      >
        <IndexTable.Cell>
          <Thumbnail
            size="small"
            source={product.imageUrl || PLACEHOLDER_IMG}
            alt={product.title}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Button variant="plain" onClick={() => navigate(`/listings/${product.shopifyProductId}`)}>
            {product.title}
          </Button>
        </IndexTable.Cell>
        <IndexTable.Cell>{product.sku || '—'}</IndexTable.Cell>
        <IndexTable.Cell>{formatMoney(product.price)}</IndexTable.Cell>
        <IndexTable.Cell>{getShopifyStatusBadge(product.shopifyStatus)}</IndexTable.Cell>
        <IndexTable.Cell>{getBinaryBadge(product.hasAiDescription)}</IndexTable.Cell>
        <IndexTable.Cell>{getBinaryBadge(product.hasProcessedImages)}</IndexTable.Cell>
        <IndexTable.Cell>{getEbayBadge(product.ebayStatus)}</IndexTable.Cell>
        <IndexTable.Cell>
          <div onClick={(event) => event.stopPropagation()}>
            <ButtonGroup>
              <Button
                size="slim"
                icon={<Play className="w-3 h-3" />}
                onClick={() => runPipelineMutation.mutate(product.shopifyProductId)}
                loading={runPipelineMutation.isPending && runPipelineMutation.variables === product.shopifyProductId}
              >
                Run Pipeline
              </Button>
              <Button
                size="slim"
                icon={<ExternalLink className="w-3 h-3" />}
                onClick={() => product.ebayListingId && window.open(`https://www.ebay.com/itm/${product.ebayListingId}`, '_blank')}
                disabled={!canViewEbay}
              >
                View on eBay
              </Button>
            </ButtonGroup>
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const pagination = (
    <Pagination
      hasPrevious={currentPage > 1}
      onPrevious={() => setPage((prev) => Math.max(1, prev - 1))}
      hasNext={currentPage < totalPages}
      onNext={() => setPage((prev) => Math.min(totalPages, prev + 1))}
    />
  );

  return (
    <Page title="Product Management Hub" subtitle="Unified Shopify + pipeline + eBay status">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" gap="300" wrap>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Catalog Summary</Text>
                  <Text tone="subdued" as="p">All Shopify products with pipeline and eBay status.</Text>
                </BlockStack>
                <InlineStack gap="400" wrap>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{summary.total}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Total products</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{summary.withDescriptions}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">AI descriptions</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{summary.withProcessedImages}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Images processed</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{summary.listedOnEbay}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Listed on eBay</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingMd" as="p">{summary.draftOnEbay}</Text>
                    <Text variant="bodySm" tone="subdued" as="p">Draft on eBay</Text>
                  </BlockStack>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" align="space-between" wrap>
                <TextField
                  label=""
                  placeholder="Search by product name or SKU"
                  value={searchValue}
                  onChange={(value) => {
                    setSearchValue(value);
                    setPage(1);
                  }}
                  prefix={<Search className="w-4 h-4" />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                  autoComplete="off"
                />
                <InlineStack gap="200" wrap>
                  <Select
                    label="Status"
                    labelHidden
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value);
                      setPage(1);
                    }}
                    options={[
                      { label: 'All', value: 'all' },
                      { label: 'Ready to List', value: 'ready' },
                      { label: 'Needs Description', value: 'needs_description' },
                      { label: 'Needs Images', value: 'needs_images' },
                      { label: 'Listed', value: 'listed' },
                      { label: 'Not Listed', value: 'not_listed' },
                    ]}
                  />
                  <Select
                    label="Sort by"
                    labelHidden
                    value={sortKey}
                    onChange={(value) => setSortKey(value)}
                    options={[
                      { label: 'Product Name', value: 'title' },
                      { label: 'SKU', value: 'sku' },
                      { label: 'Price', value: 'price' },
                      { label: 'Shopify Status', value: 'shopifyStatus' },
                      { label: 'AI Description', value: 'ai' },
                      { label: 'Images Processed', value: 'images' },
                      { label: 'eBay Status', value: 'ebayStatus' },
                    ]}
                  />
                  <Button
                    icon={sortDirection === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
                    onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  >
                    {sortDirection === 'asc' ? 'Asc' : 'Desc'}
                  </Button>
                </InlineStack>
              </InlineStack>

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
                  itemCount={pageItems.length}
                  headings={[
                    { title: 'Thumbnail' },
                    { title: 'Product Name' },
                    { title: 'SKU' },
                    { title: 'Price' },
                    { title: 'Shopify Status' },
                    { title: 'AI Description' },
                    { title: 'Images Processed' },
                    { title: 'eBay Status' },
                    { title: 'Actions' },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="center" gap="400">
            <Text tone="subdued" as="p">
              Showing {pageItems.length} of {sorted.length} products
            </Text>
            {pagination}
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default ShopifyProducts;
