import React, { useMemo, useState, useCallback } from 'react';
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
  BlockStack,
  Layout,
  Page,
  Pagination,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris';
import { ExternalLink, Filter, Play, Search, SortAsc, SortDesc } from 'lucide-react';
import {
  SearchIcon,
  CheckCircleIcon,
  ExternalSmallIcon,
} from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, useListings, useProductNotes, useSaveProductNotes, useTimCondition, useTagProductCondition } from '../hooks/useApi';
import { useAppStore } from '../store';
import PhotoGallery, { type GalleryImage } from '../components/PhotoGallery';
import PhotoControls, { type PhotoRoomParams } from '../components/PhotoControls';
import ActivePhotosGallery, { type ActivePhoto } from '../components/ActivePhotosGallery';
import EditPhotosPanel, { type EditablePhoto } from '../components/EditPhotosPanel';
import TemplateManager from '../components/TemplateManager';
import InlineDraftApproval from '../components/InlineDraftApproval';
// PipelineReviewModal removed — review now happens at /review/:id

/* ── Simple markdown → HTML for AI description preview ── */
function mdInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}
function markdownToHtml(md: string): string {
  // Strip unwanted labels from AI output
  const cleaned = md
    .replace(/^\*\*Title line:\*\*\s*/gm, '')
    .replace(/^Title line:\s*/gm, '')
    .replace(/^\*\*Intro:\*\*\s*/gm, '')
    .replace(/^Intro:\s*/gm, '');
  
  const lines = cleaned.split('\n');
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { if (inList) { html.push('</ul>'); inList = false; } continue; }
    if (trimmed.startsWith('### ')) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3>${mdInline(trimmed.slice(4))}</h3>`); continue; }
    if (trimmed.startsWith('## ')) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2>${mdInline(trimmed.slice(3))}</h2>`); continue; }
    if (trimmed.startsWith('# ')) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1>${mdInline(trimmed.slice(2))}</h1>`); continue; }
    const bullet = trimmed.match(/^[-*✔✅☑●•►▸]\s*(.+)/);
    if (bullet) { if (!inList) { html.push('<ul>'); inList = true; } html.push(`<li>${mdInline(bullet[1])}</li>`); continue; }
    if (inList) { html.push('</ul>'); inList = false; }
    html.push(`<p>${mdInline(trimmed)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

/* ────────────────────────── helpers ────────────────────────── */

const PLACEHOLDER_IMG =
  'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';

const formatMoney = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '-';
  const numberValue = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numberValue)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numberValue);
};

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '-';
  const ms = typeof value === 'number' ? (value > 1_000_000_000_000 ? value : value * 1000) : Date.parse(value);
  if (Number.isNaN(ms)) return '-';
  return new Date(ms).toLocaleString();
};

const getShopifyStatusBadge = (status?: string | null) => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'active') return <Badge tone="success">Active</Badge>;
  if (normalized === 'draft') return <Badge>Draft</Badge>;
  if (normalized === 'archived') return <Badge tone="warning">Archived</Badge>;
  return <Badge>{status || 'unknown'}</Badge>;
};

const getEbayBadge = (status: string) => {
  if (status === 'listed') return <Badge tone="success">Listed</Badge>;
  if (status === 'draft') return <Badge tone="info">Draft</Badge>;
  return <Text as="span" tone="subdued">-</Text>;
};

const StatusDot: React.FC<{ done: boolean; label?: string }> = ({ done, label }) => (
  <InlineStack gap="100" blockAlign="center" wrap={false}>
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: done ? '#22c55e' : '#d1d5db',
    }} />
    {label && <Text as="span" tone={done ? undefined : 'subdued'} variant="bodySm">{label}</Text>}
  </InlineStack>
);

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
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [galleryViewMode, setGalleryViewMode] = useState<'side-by-side' | 'toggle'>('side-by-side');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPhotoControls, setShowPhotoControls] = useState(false);
  const [showEditHtml, setShowEditHtml] = useState(false);
  
  // New photo management state
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<number[]>([]);
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [processingPhotos, setProcessingPhotos] = useState<Set<number>>(new Set());
  
  // Pipeline Review Modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any>(null);

  // TIM Condition data
  const { data: timData, isLoading: timLoading } = useTimCondition(id);
  const tagMutation = useTagProductCondition(id);

  // Product Notes state
  const { data: notesData } = useProductNotes(id);
  const saveNotesMutation = useSaveProductNotes();
  const [localNotes, setLocalNotes] = useState('');
  const [notesInitialized, setNotesInitialized] = useState(false);

  // Sync fetched notes into local state
  React.useEffect(() => {
    if (notesData?.notes !== undefined && !notesInitialized) {
      setLocalNotes(notesData.notes);
      setNotesInitialized(true);
    }
  }, [notesData, notesInitialized]);

  // Reset when product changes
  React.useEffect(() => {
    setNotesInitialized(false);
  }, [id]);

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

  // ── Fetch current Shopify images (active photos) ──
  const { data: activePhotosData, isLoading: activePhotosLoading } = useQuery({
    queryKey: ['active-photos', id],
    queryFn: async () => {
      // Fetch from product info to get current Shopify images
      const productData = await apiClient.get<{ ok: boolean; product?: any }>(`/test/product-info/${id}`);
      const images = productData?.product?.images || [];
      return images.map((img: any) => ({
        id: img.id,
        position: img.position,
        src: img.src,
        alt: img.alt,
      }));
    },
    enabled: Boolean(id),
    refetchInterval: 10000,
  });

  const activePhotos: ActivePhoto[] = activePhotosData ?? [];

  // ── Phase 2: Fetch image gallery data ──
  const { data: imageData, isLoading: imagesLoading } = useQuery({
    queryKey: ['product-images', id],
    queryFn: () =>
      apiClient.get<{
        ok: boolean;
        images: GalleryImage[];
        totalOriginal: number;
        totalProcessed: number;
      }>(`/products/${id}/images`),
    enabled: Boolean(id),
    refetchInterval: 15000,
  });

  const galleryImages: GalleryImage[] = imageData?.images ?? [];

  // Transform active photos into editable photos for the edit panel
  const editablePhotos: EditablePhoto[] = activePhotos.map(photo => {
    const galleryMatch = galleryImages.find(img => img.originalUrl === photo.src);
    return {
      id: photo.id,
      originalUrl: photo.src,
      alt: photo.alt,
      processing: processingPhotos.has(photo.id),
      processed: !!galleryMatch?.processedUrl,
      processedUrl: galleryMatch?.processedUrl,
    };
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

  const pipelineJob = pipelineJobs?.jobs?.[0];
  const pipelineSteps = pipelineJob?.steps ?? [];
  const aiDescription = pipelineStatus?.status?.ai_description ?? null;

  const runPipelineMutation = useMutation({
    mutationFn: () => apiClient.post(`/auto-list/${id}`),
    onSuccess: async (result: any) => {
      if (result?.success || result?.ok) {
        setPipelineResult(result);
        addNotification({
          type: 'success',
          title: 'Pipeline completed!',
          message: 'Review the results in the Review Queue.',
          autoClose: 4000
        });
        // Navigate to the draft review page
        try {
          const draftData = await apiClient.get<any>(`/drafts/product/${id}`);
          if (draftData?.draft?.id) {
            navigate(`/review/${draftData.draft.id}`);
          }
        } catch { /* draft may not exist yet, that's ok */ }
      } else {
        addNotification({
          type: 'error',
          title: 'Pipeline failed',
          message: result?.error || 'AI processing did not return complete results. Try again.',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['product-pipeline-status', id] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-jobs', id] });
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
      queryClient.invalidateQueries({ queryKey: ['product-pipeline-status', id] });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'AI generation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // ── Phase 2: Reprocess single image ──
  const reprocessMutation = useMutation({
    mutationFn: ({ imageUrl, params }: { imageUrl: string; params: PhotoRoomParams }) =>
      apiClient.post<{ ok: boolean; processedUrl?: string }>(`/products/${id}/images/reprocess`, {
        imageUrl,
        background: params.background,
        padding: params.padding,
        shadow: params.shadow,
      }),
    onSuccess: (data) => {
      setPreviewUrl(data?.processedUrl ?? null);
      queryClient.invalidateQueries({ queryKey: ['product-images', id] });
      addNotification({ type: 'success', title: 'Image reprocessed successfully', autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Reprocessing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // ── Phase 2: Reprocess all images ──
  const reprocessAllMutation = useMutation({
    mutationFn: (params: PhotoRoomParams) =>
      apiClient.post<{ ok: boolean; succeeded: number; failed: number }>(`/products/${id}/images/reprocess-all`, {
        background: params.background,
        padding: params.padding,
        shadow: params.shadow,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['product-images', id] });
      addNotification({
        type: 'success',
        title: 'All images reprocessed',
        message: `${data?.succeeded ?? 0} succeeded, ${data?.failed ?? 0} failed`,
        autoClose: 4000,
      });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Bulk reprocessing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const handleReprocess = useCallback(
    (imageUrl: string, params: PhotoRoomParams) => {
      setPreviewUrl(null);
      reprocessMutation.mutate({ imageUrl, params });
    },
    [reprocessMutation],
  );

  const handleReprocessAll = useCallback(
    (params: PhotoRoomParams) => {
      reprocessAllMutation.mutate(params);
    },
    [reprocessAllMutation],
  );

  const handleSelectImage = useCallback((img: GalleryImage) => {
    setSelectedImageUrl((prev) => (prev === img.originalUrl ? null : img.originalUrl));
    setPreviewUrl(null);
  }, []);

  const statusBadge = product?.status ? getShopifyStatusBadge(product.status) : null;

  const handleImageEditClick = useCallback((imageUrl: string) => {
    setSelectedImageUrl(imageUrl);
    setShowPhotoControls(true);
  }, []);

  // ── Delete mutations ──
  const deleteSingleImageMutation = useMutation({
    mutationFn: (imageId: number) =>
      apiClient.delete(`/products/${id}/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-photos', id] });
      queryClient.invalidateQueries({ queryKey: ['product-images', id] });
      addNotification({ type: 'success', title: 'Image deleted', autoClose: 3000 });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Delete failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const deleteBulkImagesMutation = useMutation({
    mutationFn: (imageIds: number[]) =>
      apiClient.delete(`/products/${id}/images`, { imageIds }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['active-photos', id] });
      queryClient.invalidateQueries({ queryKey: ['product-images', id] });
      setSelectedPhotoIds([]);
      const succeeded = data?.succeeded || 0;
      const failed = data?.failed || 0;
      addNotification({ 
        type: 'success', 
        title: `Deleted ${succeeded} image${succeeded !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}`, 
        autoClose: 4000 
      });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Bulk delete failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // ── Pipeline Review Modal Mutations ──
  const applyChangesMutation = useMutation({
    mutationFn: async (selections: { description: boolean; photos: boolean; ebayListing: boolean }) => {
      const promises: Promise<any>[] = [];

      if (selections.description && pipelineResult?.description) {
        promises.push(
          apiClient.post('/test/update-product', {
            productId: id,
            body_html: markdownToHtml(pipelineResult.description)
          })
        );
      }

      if (selections.photos && pipelineResult?.images) {
        // Photo upload logic - for now just log the images
        console.log('Applying processed photos:', pipelineResult.images);
      }

      if (selections.ebayListing) {
        promises.push(
          apiClient.post('/ebay/create-draft', {
            productId: id,
            description: pipelineResult?.description,
            categoryId: pipelineResult?.categoryId,
            images: pipelineResult?.images,
          })
        );
      }

      await Promise.all(promises);
    },
    onSuccess: () => {
      addNotification({
        type: 'success',
        title: 'Changes applied successfully!',
        autoClose: 4000
      });
      queryClient.invalidateQueries({ queryKey: ['product-info', id] });
      queryClient.invalidateQueries({ queryKey: ['draft', id] });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Failed to apply changes',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Check for existing draft
  const { data: existingDraft } = useQuery({
    queryKey: ['draft', id],
    queryFn: () => apiClient.get(`/drafts/product/${id}`),
  });

  // ── Photo processing functions ──
  const handleProcessSinglePhoto = useCallback(async (photoId: number, params: PhotoRoomParams) => {
    const photo = activePhotos.find(p => p.id === photoId);
    if (!photo) return;

    setProcessingPhotos(prev => new Set(prev).add(photoId));
    
    try {
      await apiClient.post(`/products/${id}/images/reprocess`, {
        imageUrl: photo.src,
        ...params,
      });
      queryClient.invalidateQueries({ queryKey: ['product-images', id] });
      addNotification({ type: 'success', title: 'Photo processed', autoClose: 3000 });
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setProcessingPhotos(prev => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  }, [activePhotos, id, queryClient, addNotification]);

  const handleProcessSelectedPhotos = useCallback(async (photoIds: number[], params: PhotoRoomParams) => {
    setProcessingPhotos(prev => new Set([...prev, ...photoIds]));
    
    let successCount = 0;
    let errorCount = 0;

    for (const photoId of photoIds) {
      const photo = activePhotos.find(p => p.id === photoId);
      if (!photo) continue;

      try {
        await apiClient.post(`/products/${id}/images/reprocess`, {
          imageUrl: photo.src,
          ...params,
        });
        successCount++;
      } catch (error) {
        errorCount++;
      }
    }

    setProcessingPhotos(prev => {
      const next = new Set(prev);
      photoIds.forEach(id => next.delete(id));
      return next;
    });

    queryClient.invalidateQueries({ queryKey: ['product-images', id] });
    
    if (successCount > 0 && errorCount === 0) {
      addNotification({ 
        type: 'success', 
        title: `Processed ${successCount} photo${successCount !== 1 ? 's' : ''}`, 
        autoClose: 3000 
      });
    } else if (successCount > 0) {
      addNotification({ 
        type: 'warning', 
        title: `Processed ${successCount}, ${errorCount} failed`, 
        autoClose: 4000 
      });
    } else {
      addNotification({ 
        type: 'error', 
        title: `Failed to process ${errorCount} photo${errorCount !== 1 ? 's' : ''}`, 
        autoClose: 4000 
      });
    }
  }, [activePhotos, id, queryClient, addNotification]);

  const handleProcessAllPhotos = useCallback(async (params: PhotoRoomParams) => {
    try {
      const result = await reprocessAllMutation.mutateAsync(params);
      addNotification({
        type: 'success',
        title: 'All photos processed',
        message: `${result?.succeeded ?? 0} succeeded, ${result?.failed ?? 0} failed`,
        autoClose: 4000,
      });
    } catch (error) {
      // Error handling is already in the mutation
    }
  }, [reprocessAllMutation, addNotification]);

  // ── Edit panel handlers ──
  const handleEditPhotos = useCallback((photoIds: number[]) => {
    setSelectedPhotoIds(photoIds);
    setEditPanelOpen(true);
  }, []);

  const handleDeleteSingle = useCallback((imageId: number) => {
    deleteSingleImageMutation.mutate(imageId);
  }, [deleteSingleImageMutation]);

  const handleDeleteBulk = useCallback((imageIds: number[]) => {
    deleteBulkImagesMutation.mutate(imageIds);
  }, [deleteBulkImagesMutation]);

  // ── Pipeline Step Display Names ──
  const getStepDisplayName = useCallback((step: string): string => {
    const stepMap: Record<string, string> = {
      fetch_product: 'Fetch Product',
      generate_description: 'Generate Description',
      process_images: 'Process Images',
      create_ebay_listing: 'Save to Review',
    };
    return stepMap[step] || step.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
  }, []);

  // ── Pipeline Review Modal Handlers ──
  const handleSaveDraft = useCallback(() => {
    addNotification({
      type: 'info',
      title: 'Draft saved for later review',
      autoClose: 4000
    });
  }, [addNotification]);

  return (
    <div>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
          
          .product-detail-page {
            --polaris-color-bg-surface: #ffffff;
            --polaris-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1);
          }
          
          .premium-card {
            background: var(--polaris-color-bg-surface);
            box-shadow: var(--polaris-shadow-card);
            border-radius: 12px;
            border: 1px solid #e5e7eb;
          }
        `}
      </style>
    <Page
      title={product?.title ?? 'Loading product…'}
      subtitle={id ? `Shopify ID ${id}` : undefined}
      backAction={{ content: 'Products', onAction: () => navigate('/listings') }}
      primaryAction={{
        content: '🚀 Run Pipeline',
        onAction: () => runPipelineMutation.mutate(),
        loading: runPipelineMutation.isPending,
      }}
      secondaryActions={
        product
          ? [
              {
                content: 'View in Shopify',
                icon: ExternalSmallIcon,
                url: `https://admin.shopify.com/store/usedcameragear/products/${id}`,
                external: true,
              },
            ]
          : undefined
      }
    >
      {productLoading && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner accessibilityLabel="Loading product" size="large" />
        </div>
      )}

      {product && (
        <>
          {/* ── Draft Ready Banner ── */}
          {existingDraft && (existingDraft as any)?.draft?.id && (
            <Banner
              title="Draft ready for review"
              tone="info"
              action={{
                content: 'Review Now',
                onAction: () => navigate(`/review/${(existingDraft as any).draft.id}`),
              }}
            >
              <p>Pipeline has completed for this product. Review and apply the changes.</p>
            </Banner>
          )}

          {/* ── Inline Draft Approval Banner ── */}
          <InlineDraftApproval productId={id!} />

          <Layout>
            {/* ── LEFT COLUMN (2/3) ── */}
            <Layout.Section>
              <BlockStack gap="500">
              {/* ── Active Photos Gallery ── */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Text variant="headingMd" as="h2">Product Photos</Text>
                      {activePhotos.length > 0 && (
                        <Badge tone="info">{`${activePhotos.length} photo${activePhotos.length !== 1 ? 's' : ''}`}</Badge>
                      )}
                    </InlineStack>
                    {activePhotos.length > 0 && (
                      <Button
                        variant="secondary"
                        size="slim"
                        onClick={() => setEditPanelOpen(prev => !prev)}
                      >
                        {editPanelOpen ? 'Hide' : 'Show'} Photo Editor
                      </Button>
                    )}
                  </InlineStack>
                  
                  <ActivePhotosGallery
                    photos={activePhotos}
                    loading={activePhotosLoading}
                    onDeleteSingle={handleDeleteSingle}
                    onDeleteBulk={handleDeleteBulk}
                    onEditPhotos={handleEditPhotos}
                    onSelectionChange={setSelectedPhotoIds}
                  />
                </BlockStack>
              </Card>

            {/* ── Edit Photos Panel ── */}
            <EditPhotosPanel
              photos={editablePhotos}
              selectedPhotoIds={selectedPhotoIds}
              isOpen={editPanelOpen}
              onToggle={() => setEditPanelOpen(prev => !prev)}
              onProcessSingle={handleProcessSinglePhoto}
              onProcessSelected={handleProcessSelectedPhotos}
              onProcessAll={handleProcessAllPhotos}
              processing={reprocessAllMutation.isPending || processingPhotos.size > 0}
            />

            {/* ── Legacy Photo Gallery (for comparison/debugging) ── */}
            {process.env.NODE_ENV === 'development' && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">Legacy Gallery (Dev Only)</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {galleryImages.length > 0 && (
                        <Badge tone="info">{`${galleryImages.length} images`}</Badge>
                      )}
                      <Button
                        onClick={() => handleReprocessAll({ background: '#ffffff', padding: 0.1, shadow: false })}
                        loading={reprocessAllMutation.isPending}
                      >
                        Reprocess All
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {imagesLoading ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <Spinner accessibilityLabel="Loading images" />
                    </div>
                  ) : galleryImages.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <Text tone="subdued" as="p">No images found for this product</Text>
                    </div>
                  ) : (
                    <PhotoGallery
                      images={galleryImages}
                      loading={imagesLoading}
                      viewMode={galleryViewMode}
                      onViewModeChange={setGalleryViewMode}
                      onSelectImage={handleSelectImage}
                      selectedImageUrl={selectedImageUrl}
                      onEditImage={handleImageEditClick}
                    />
                  )}
                </BlockStack>
              </Card>
            )}

              {/* ── AI Description Approval Banner ── */}
              {aiDescription && (
                <Card>
                  <Banner
                    tone="success"
                    title="✨ AI Description Ready"
                    action={{
                      content: "Use This Description",
                      onAction: async () => {
                        try {
                          const htmlContent = markdownToHtml(aiDescription);
                          await apiClient.post(`/api/test/update-product`, {
                            productId: id,
                            body_html: htmlContent
                          });
                          addNotification({ 
                            type: 'success', 
                            title: 'Description updated', 
                            message: 'AI description has been applied to your product',
                            autoClose: 4000 
                          });
                          queryClient.invalidateQueries({ queryKey: ['product-info', id] });
                        } catch (error) {
                          addNotification({
                            type: 'error',
                            title: 'Update failed',
                            message: error instanceof Error ? error.message : 'Failed to update product description',
                          });
                        }
                      }
                    }}
                    secondaryAction={{
                      content: "Dismiss",
                      onAction: () => {
                        queryClient.setQueryData(['product-pipeline-status', id], (old: any) => ({
                          ...old,
                          status: { ...old?.status, ai_description: null }
                        }));
                      }
                    }}
                  >
                    <BlockStack gap="200">
                      <Text as="p">A new AI-generated description is ready to apply to your product.</Text>
                      <div
                        style={{ 
                          maxHeight: '150px', 
                          overflow: 'auto', 
                          padding: '12px', 
                          background: '#f8f9fa', 
                          borderRadius: '8px',
                          border: '1px solid #e1e3e5',
                          fontSize: '14px'
                        }}
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(aiDescription.slice(0, 200) + '...') }}
                      />
                    </BlockStack>
                  </Banner>
                </Card>
              )}

              {/* ── Photos Processed Approval Banner ── */}
              {(() => {
                const processedPhotos = galleryImages.filter(img => img.processedUrl);
                return processedPhotos.length > 0 && (
                  <Card>
                    <Banner
                      tone="info"
                      title={`📸 ${processedPhotos.length} Photos Processed`}
                      action={{
                        content: "Apply All to Shopify",
                        onAction: async () => {
                          try {
                            // This would need an actual API endpoint to apply processed images
                            addNotification({ 
                              type: 'success', 
                              title: 'Photos applied', 
                              message: `${processedPhotos.length} processed photos applied to Shopify`,
                              autoClose: 4000 
                            });
                          } catch (error) {
                            addNotification({
                              type: 'error',
                              title: 'Apply failed',
                              message: error instanceof Error ? error.message : 'Failed to apply processed photos',
                            });
                          }
                        }
                      }}
                      secondaryAction={{
                        content: "Dismiss",
                        onAction: () => {
                          // Could implement a way to mark these as dismissed
                        }
                      }}
                    >
                      <Text as="p">Background removal and enhancement complete. Ready to apply to your Shopify product?</Text>
                    </Banner>
                  </Card>
                );
              })()}

              {/* ── Product Notes ── */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingMd" as="h2">Product Notes</Text>
                      {localNotes.trim() && <Badge tone="attention">Has Notes</Badge>}
                    </InlineStack>
                    <Button
                      variant="primary"
                      size="slim"
                      onClick={() => {
                        if (id) saveNotesMutation.mutate({ productId: id, notes: localNotes });
                      }}
                      loading={saveNotesMutation.isPending}
                      disabled={!id || localNotes === (notesData?.notes ?? '')}
                    >
                      Save Notes
                    </Button>
                  </InlineStack>
                  <TextField
                    label=""
                    labelHidden
                    value={localNotes}
                    onChange={setLocalNotes}
                    multiline={4}
                    placeholder="Add condition notes, blemishes, missing accessories, etc. These will be injected into AI-generated descriptions."
                    autoComplete="off"
                    onBlur={() => {
                      if (id && localNotes !== (notesData?.notes ?? '')) {
                        saveNotesMutation.mutate({ productId: id, notes: localNotes });
                      }
                    }}
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 Notes are automatically included when generating AI descriptions.
                  </Text>
                </BlockStack>
              </Card>

              {/* ── Description Section ── */}
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">Description</Text>
                    <Button
                      icon={<Play className="w-4 h-4" />}
                      onClick={() => aiMutation.mutate()}
                      loading={aiMutation.isPending}
                      variant="secondary"
                    >
                      Regenerate with AI
                    </Button>
                  </InlineStack>

                  {aiDescription ? (
                    <BlockStack gap="400">
                      <div
                        style={{
                          padding: '16px',
                          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                          borderRadius: '12px',
                          border: '2px solid #0ea5e9',
                          boxShadow: '0 4px 6px -1px rgba(14, 165, 233, 0.1)'
                        }}
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Text variant="headingSm" as="h3">🤖 AI Generated Description</Text>
                              <Badge tone="info">Draft</Badge>
                            </InlineStack>
                            <Button
                              variant="primary"
                              size="slim"
                              onClick={async () => {
                                try {
                                  const htmlContent = markdownToHtml(aiDescription);
                                  await apiClient.post(`/api/test/update-product`, {
                                    productId: id,
                                    body_html: htmlContent
                                  });
                                  addNotification({ 
                                    type: 'success', 
                                    title: 'Description updated', 
                                    message: 'AI description has been applied to your product',
                                    autoClose: 4000 
                                  });
                                  queryClient.invalidateQueries({ queryKey: ['product-info', id] });
                                } catch (error) {
                                  addNotification({
                                    type: 'error',
                                    title: 'Update failed',
                                    message: error instanceof Error ? error.message : 'Failed to update product description',
                                  });
                                }
                              }}
                            >
                              Use This Description
                            </Button>
                          </InlineStack>
                          <div
                            style={{ 
                              maxHeight: '300px', 
                              overflow: 'auto', 
                              padding: '16px', 
                              background: '#ffffff', 
                              borderRadius: '8px',
                              border: '1px solid #e5e7eb',
                              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                            }}
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(aiDescription) }}
                          />
                        </BlockStack>
                      </div>
                    </BlockStack>
                  ) : null}

                  {/* Current Description */}
                  <Divider />
                  {product.body_html ? (
                    <BlockStack gap="400">
                      <Text variant="headingSm" as="h3">Current Description</Text>
                      <div
                        style={{ 
                          maxHeight: '300px', 
                          overflow: 'auto', 
                          padding: '20px', 
                          background: '#ffffff', 
                          borderRadius: '12px',
                          border: '1px solid #e5e7eb',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                          fontSize: '14px',
                          lineHeight: '1.6'
                        }}
                        dangerouslySetInnerHTML={{ __html: product.body_html }}
                      />
                      
                      <details>
                        <summary
                          style={{
                            padding: '8px 12px',
                            background: '#f8f9fa',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            cursor: 'pointer',
                            fontFamily: 'SF Mono, Monaco, monospace',
                            fontSize: '13px',
                            userSelect: 'none'
                          }}
                        >
                          📝 View HTML Source
                        </summary>
                        <div
                          style={{ 
                            marginTop: '8px',
                            maxHeight: '200px', 
                            overflow: 'auto', 
                            padding: '16px', 
                            background: '#1e1e1e', 
                            color: '#ffffff',
                            borderRadius: '8px',
                            border: '1px solid #374151',
                            fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                            fontSize: '12px',
                            lineHeight: '1.5'
                          }}
                        >
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{product.body_html}</pre>
                        </div>
                      </details>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="300" align="center">
                      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <Text variant="headingSm" as="h3" tone="subdued">No description yet</Text>
                        <Text tone="subdued" as="p">Use AI to generate a compelling product description</Text>
                      </div>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
              </BlockStack>
            </Layout.Section>

            {/* ── RIGHT SIDEBAR (1/3) ── */}
            <Layout.Section variant="oneThird">
              <BlockStack gap="500">
                
                {/* ── Product Status & Details ── */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">Product Details</Text>
                      {statusBadge}
                    </InlineStack>
                    <Divider />
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">Price</Text>
                        <Text variant="bodyMd" fontWeight="medium" as="span">{formatMoney(variant?.price ?? null)}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">Compare-at price</Text>
                        <Text variant="bodyMd" as="span">{formatMoney(variant?.compare_at_price ?? null)}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">SKU</Text>
                        <span style={{ fontFamily: 'SF Mono, monospace' }}>
                          <Text variant="bodyMd" as="span">{variant?.sku ?? '—'}</Text>
                        </span>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">Barcode</Text>
                        <span style={{ fontFamily: 'SF Mono, monospace' }}>
                          <Text variant="bodyMd" as="span">{variant?.barcode ?? '—'}</Text>
                        </span>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">Inventory</Text>
                        <Text variant="bodyMd" fontWeight="medium" as="span">{variant?.inventory_quantity ?? '—'}</Text>
                      </InlineStack>
                    </BlockStack>
                    <Divider />
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">Vendor</Text>
                        <Text variant="bodyMd" as="span">{product.vendor ?? '—'}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" tone="subdued" as="span">Product type</Text>
                        <Text variant="bodyMd" as="span">{product.product_type ?? '—'}</Text>
                      </InlineStack>
                      {product.tags && (
                        <BlockStack gap="200">
                          <Text variant="bodyMd" tone="subdued" as="span">Tags</Text>
                          <InlineStack gap="100" wrap>
                            {(typeof product.tags === 'string' ? product.tags.split(',') : product.tags).map((tag: string) => (
                              <Badge key={tag.trim()}>{tag.trim()}</Badge>
                            ))}
                          </InlineStack>
                        </BlockStack>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Card>

                {/* ── TIM Condition ── */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">TIM Condition</Text>
                      {timData?.match?.condition && (
                        <Badge tone={
                          timData.match.condition === 'like_new_minus' || timData.match.condition === 'excellent_plus' ? 'success' :
                          timData.match.condition === 'excellent' ? 'success' :
                          timData.match.condition === 'poor' || timData.match.condition === 'ugly' ? 'warning' : 'info'
                        }>
                          {timData.match.condition.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Badge>
                      )}
                    </InlineStack>
                    <Divider />
                    {timLoading ? (
                      <Spinner size="small" />
                    ) : timData?.match ? (
                      <BlockStack gap="300">
                        {timData.match.condition && (
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" tone="subdued" as="span">Grade</Text>
                            <Text variant="bodyMd" fontWeight="medium" as="span">
                              {timData.match.condition.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                            </Text>
                          </InlineStack>
                        )}
                        {timData.match.conditionNotes && (
                          <BlockStack gap="100">
                            <Text variant="bodyMd" tone="subdued" as="span">Condition Notes</Text>
                            <Text variant="bodyMd" as="p">{timData.match.conditionNotes}</Text>
                          </BlockStack>
                        )}
                        {timData.match.graderNotes && (
                          <BlockStack gap="100">
                            <Text variant="bodyMd" tone="subdued" as="span">Grader Notes</Text>
                            <Text variant="bodyMd" as="p">{timData.match.graderNotes}</Text>
                          </BlockStack>
                        )}
                        {timData.match.serialNumber && (
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" tone="subdued" as="span">Serial #</Text>
                            <span style={{ fontFamily: 'SF Mono, monospace' }}>
                              <Text variant="bodyMd" as="span">{timData.match.serialNumber}</Text>
                            </span>
                          </InlineStack>
                        )}
                        <InlineStack align="space-between">
                          <Text variant="bodyMd" tone="subdued" as="span">TIM Status</Text>
                          <Text variant="bodyMd" as="span">{timData.match.itemStatus.replace(/_/g, ' ')}</Text>
                        </InlineStack>
                        <Divider />
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text variant="bodyMd" tone="subdued" as="span">Condition Tag</Text>
                            {(() => {
                              const tags = typeof product.tags === 'string' ? product.tags.split(',').map((t: string) => t.trim()) : (product.tags ?? []);
                              const conditionTag = tags.find((t: string) => t.startsWith('condition-'));
                              return conditionTag ? (
                                <Badge tone="success">{conditionTag}</Badge>
                              ) : (
                                <Badge tone="attention">Not tagged</Badge>
                              );
                            })()}
                          </BlockStack>
                          {timData.match.condition && (
                            <Button
                              size="slim"
                              onClick={() => tagMutation.mutate()}
                              loading={tagMutation.isPending}
                              disabled={tagMutation.isPending}
                            >
                              {(() => {
                                const tags = typeof product.tags === 'string' ? product.tags.split(',').map((t: string) => t.trim()) : (product.tags ?? []);
                                const conditionTag = tags.find((t: string) => t.startsWith('condition-'));
                                return conditionTag ? 'Update Tag' : 'Tag Product';
                              })()}
                            </Button>
                          )}
                        </InlineStack>
                        {tagMutation.isSuccess && tagMutation.data && (
                          <Banner tone="success" onDismiss={() => tagMutation.reset()}>
                            {(tagMutation.data as any).newTag
                              ? `Tagged: ${(tagMutation.data as any).newTag}`
                              : 'Tag applied successfully'}
                          </Banner>
                        )}
                        {tagMutation.isError && (
                          <Banner tone="critical" onDismiss={() => tagMutation.reset()}>
                            Failed to apply tag
                          </Banner>
                        )}
                      </BlockStack>
                    ) : (
                      <Text variant="bodyMd" tone="subdued" as="p">
                        No TIM data — {timData?.reason || 'no matching item found'}
                      </Text>
                    )}
                  </BlockStack>
                </Card>

                {/* ── eBay Listing Status ── */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">eBay Listing</Text>
                      {listing?.ebayListingId && (
                        listing.ebayListingId.startsWith('draft-') ? (
                          <Badge tone="attention">Draft</Badge>
                        ) : (
                          <Badge tone={listing.status === 'active' || listing.status === 'synced' ? 'success' : 'info'}>
                            {listing.status === 'synced' ? 'Live' : listing.status}
                          </Badge>
                        )
                      )}
                    </InlineStack>
                    <Divider />
                    {listing?.ebayListingId ? (
                      <BlockStack gap="400">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" tone="subdued" as="span">Status</Text>
                            <Text variant="bodyMd" fontWeight="medium" as="span">
                              {listing.ebayListingId.startsWith('draft-') ? 'Draft (not published)' : 'Published'}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" tone="subdued" as="span">eBay Item ID</Text>
                            <span style={{ fontFamily: 'SF Mono, monospace' }}>
                              <Text variant="bodyMd" as="span">{listing.ebayListingId}</Text>
                            </span>
                          </InlineStack>
                        </BlockStack>
                        
                        <BlockStack gap="200">
                          {!listing.ebayListingId.startsWith('draft-') && (
                            <Button
                              fullWidth
                              variant="secondary"
                              icon={<ExternalLink className="w-4 h-4" />}
                              url={`https://www.ebay.com/itm/${listing.ebayListingId}`}
                              external
                            >
                              View on eBay
                            </Button>
                          )}
                          <Button
                            fullWidth
                            variant="plain"
                            onClick={() => navigate(`/ebay/listings/${listing.shopifyProductId}`)}
                          >
                            View Listing Details
                          </Button>
                        </BlockStack>
                      </BlockStack>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <Text tone="subdued" as="p">Not listed on eBay yet</Text>
                        <Text variant="bodySm" tone="subdued" as="p">Run the pipeline to create an eBay listing</Text>
                      </div>
                    )}
                  </BlockStack>
                </Card>

                {/* ── Pipeline Status ── */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">Pipeline Status</Text>
                      {pipelineJob?.status && (
                        <Badge 
                          tone={
                            pipelineJob.status === 'completed' ? 'success' :
                            pipelineJob.status === 'failed' ? 'critical' :
                            pipelineJob.status === 'running' ? 'attention' : 'info'
                          }
                        >
                          {pipelineJob.status}
                        </Badge>
                      )}
                    </InlineStack>
                    <Divider />
                    {pipelineSteps.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <Text tone="subdued" as="p">No pipeline runs yet</Text>
                        <Text variant="bodySm" tone="subdued" as="p">Run the pipeline to start processing</Text>
                      </div>
                    ) : (
                      <BlockStack gap="0">
                        {pipelineSteps.map((step: any, index: number) => {
                          const isLast = index === pipelineSteps.length - 1;
                          const isDone = step.status === 'done';
                          const isError = step.status === 'error';
                          const isRunning = step.status === 'running';
                          
                          return (
                            <div key={step.name} style={{ position: 'relative' }}>
                              <InlineStack gap="300" blockAlign="start">
                                {/* Timeline indicator */}
                                <div style={{ position: 'relative', marginTop: '2px' }}>
                                  <div
                                    style={{
                                      width: '16px',
                                      height: '16px',
                                      borderRadius: '50%',
                                      border: `2px solid ${
                                        isDone ? '#22c55e' :
                                        isError ? '#ef4444' :
                                        isRunning ? '#f59e0b' : '#d1d5db'
                                      }`,
                                      backgroundColor: isDone ? '#22c55e' : '#ffffff',
                                      position: 'relative',
                                      zIndex: 1
                                    }}
                                  >
                                    {isRunning && (
                                      <div
                                        style={{
                                          position: 'absolute',
                                          inset: '2px',
                                          borderRadius: '50%',
                                          backgroundColor: '#f59e0b',
                                          animation: 'pulse 2s infinite'
                                        }}
                                      />
                                    )}
                                  </div>
                                  {/* Connecting line */}
                                  {!isLast && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: '18px',
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        width: '2px',
                                        height: '24px',
                                        backgroundColor: '#e5e7eb'
                                      }}
                                    />
                                  )}
                                </div>
                                
                                {/* Step content */}
                                <div style={{ flex: 1, paddingBottom: isLast ? '0' : '16px' }}>
                                  <BlockStack gap="100">
                                  <InlineStack align="space-between" blockAlign="center">
                                    <Text 
                                      as="span" 
                                      variant="bodySm" 
                                      fontWeight={isDone ? 'medium' : 'regular'}
                                      tone={isError ? 'critical' : undefined}
                                    >
                                      {getStepDisplayName(step.name)}
                                    </Text>
                                    <Text 
                                      as="span" 
                                      variant="bodySm" 
                                      tone={
                                        isDone ? 'success' :
                                        isError ? 'critical' :
                                        isRunning ? 'subdued' : 'subdued'
                                      }
                                    >
                                      {isDone ? '✓' : isError ? '✗' : isRunning ? '⋯' : '○'}
                                    </Text>
                                  </InlineStack>
                                  {step.error && (
                                    <Text variant="bodySm" tone="critical" as="p">{step.error}</Text>
                                  )}
                                  </BlockStack>
                                </div>
                              </InlineStack>
                            </div>
                          );
                        })}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>

                {/* ── Quick Actions ── */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Quick Actions</Text>
                    <Divider />
                    <BlockStack gap="200">
                      <Button
                        fullWidth
                        variant="secondary"
                        icon={<ExternalLink className="w-4 h-4" />}
                        url={`https://admin.shopify.com/store/usedcameragear/products/${id}`}
                        external
                      >
                        View in Shopify Admin
                      </Button>
                      {product?.handle && (
                        <Button
                          fullWidth
                          variant="plain"
                          icon={<ExternalLink className="w-4 h-4" />}
                          url={`https://usedcameragear.myshopify.com/products/${product.handle}`}
                          external
                        >
                          View Live Product Page
                        </Button>
                      )}
                      <Button
                        fullWidth
                        variant="primary"
                        loading={runPipelineMutation.isPending}
                        onClick={() => runPipelineMutation.mutate()}
                      >
                        🚀 Run Full Pipeline
                      </Button>
                    </BlockStack>
                  </BlockStack>
                </Card>

              </BlockStack>
            </Layout.Section>
          </Layout>

          {/* ── Photo Controls Modal/Panel ── */}
          {showPhotoControls && (
            <div style={{ marginTop: '1rem' }}>
              <PhotoControls
                selectedImageUrl={selectedImageUrl}
                onReprocess={handleReprocess}
                onReprocessAll={handleReprocessAll}
                reprocessing={reprocessMutation.isPending}
                reprocessingAll={reprocessAllMutation.isPending}
                previewUrl={previewUrl}
                imageCount={images.length}
              />
            </div>
          )}

          {/* ── Templates Section ── */}
          <div style={{ marginTop: '1rem' }}>
            <TemplateManager
              productId={id}
              onApplied={() => {
                queryClient.invalidateQueries({ queryKey: ['product-images', id] });
              }}
            />
          </div>
        </>
      )}
    </Page>

    {/* Pipeline Review Modal removed — review now at /review/:id */}
    </div>
  );
};

/* ──────────────────── ShopifyProducts (list) ──────────────────── */

const TAB_FILTERS = [
  { id: 'all', content: 'All' },
  { id: 'draft', content: 'Draft' },
  { id: 'active', content: 'Active' },
  { id: 'needs_description', content: 'Needs Description' },
  { id: 'needs_images', content: 'Needs Images' },
  { id: 'listed', content: 'On eBay' },
] as const;

const ShopifyProducts: React.FC = () => {
  const navigate = useNavigate();
  const { addNotification } = useAppStore();

  const [searchValue, setSearchValue] = useState('');
  const [selectedTab, setSelectedTab] = useState<number>(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading, error } = useQuery({
    queryKey: ['products-overview'],
    queryFn: () => apiClient.get<ProductsOverviewResponse>('/products/overview'),
    refetchInterval: 30000,
  });

  const products = useMemo(() => data?.products ?? [], [data?.products]);

  // Pre-compute counts for tab badges
  const tabCounts = useMemo(() => {
    const nonArchived = products.filter((p) => (p.shopifyStatus ?? '').toLowerCase() !== 'archived');
    return {
      all: nonArchived.length,
      draft: nonArchived.filter((p) => (p.shopifyStatus ?? '').toLowerCase() === 'draft').length,
      active: nonArchived.filter((p) => (p.shopifyStatus ?? '').toLowerCase() === 'active').length,
      needs_description: nonArchived.filter((p) => !p.hasAiDescription).length,
      needs_images: nonArchived.filter((p) => !p.hasProcessedImages).length,
      listed: nonArchived.filter((p) => p.ebayStatus === 'listed' || p.ebayStatus === 'draft').length,
    };
  }, [products]);

  const tabs = useMemo(() => TAB_FILTERS.map((tab) => ({
    ...tab,
    content: `${tab.content} (${tabCounts[tab.id]})`,
  })), [tabCounts]);

  const statusFilter = useMemo(() => {
    return TAB_FILTERS[selectedTab]?.id ?? 'all';
  }, [selectedTab]);

  const filtered = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    const result = products.filter((product) => {
      // Exclude archived products
      if ((product.shopifyStatus ?? '').toLowerCase() === 'archived') return false;

      // Search query filter
      const matchesQuery =
        !query ||
        product.title.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query);

      if (!matchesQuery) return false;

      // Status filter
      const productStatus = (product.shopifyStatus ?? '').toLowerCase();
      
      switch (statusFilter) {
        case 'draft':
          return productStatus === 'draft';
        case 'active':
          return productStatus === 'active';
        case 'needs_description':
          return !product.hasAiDescription;
        case 'needs_images':
          return !product.hasProcessedImages;
        case 'listed':
          return product.ebayStatus === 'listed' || product.ebayStatus === 'draft';
        case 'all':
        default:
          return true;
      }
    });

    return result;
  }, [products, searchValue, statusFilter]);

  // Always sort: drafts first, then active, then alphabetical
  const sorted = useMemo(() => {
    const rank = { draft: 0, active: 1 } as Record<string, number>;
    return [...filtered].sort((a, b) => {
      const ra = rank[(a.shopifyStatus ?? '').toLowerCase()] ?? 2;
      const rb = rank[(b.shopifyStatus ?? '').toLowerCase()] ?? 2;
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title);
    });
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleTabChange = useCallback((index: number) => {
    if (index >= 0 && index < TAB_FILTERS.length) {
      setSelectedTab(index);
      setPage(1);
    }
  }, []);

  const rowMarkup = pageItems.map((product, index) => (
    <IndexTable.Row
      id={product.shopifyProductId}
      key={product.shopifyProductId}
      position={index}
      onClick={() => navigate(`/listings/${product.shopifyProductId}`)}
    >
      <IndexTable.Cell>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Thumbnail
            size="extraSmall"
            source={product.imageUrl || PLACEHOLDER_IMG}
            alt={product.title}
          />
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {product.title}
              </Text>
              {getShopifyStatusBadge(product.shopifyStatus)}
            </InlineStack>
            {product.sku && (
              <Text as="span" variant="bodySm" tone="subdued">{product.sku}</Text>
            )}
          </BlockStack>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{formatMoney(product.price)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <StatusDot done={product.hasAiDescription} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <StatusDot done={product.hasProcessedImages} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        {getEbayBadge(product.ebayStatus)}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const summary = data?.summary ?? {
    total: 0,
    withDescriptions: 0,
    withProcessedImages: 0,
    listedOnEbay: 0,
    draftOnEbay: 0,
  };

  return (
    <Page
      title="Products"
      subtitle={`${summary.total.toLocaleString()} products · ${summary.withDescriptions} descriptions · ${summary.withProcessedImages} images · ${summary.listedOnEbay + summary.draftOnEbay} on eBay`}
      fullWidth
    >
      <BlockStack gap="0">
        <Card padding="0">
          <Tabs 
            tabs={tabs} 
            selected={selectedTab} 
            onSelect={handleTabChange}
          />

          <Box padding="300">
            <TextField
              label=""
              placeholder="Search products…"
              value={searchValue}
              onChange={(value) => { setSearchValue(value); setPage(1); }}
              prefix={<Search className="w-4 h-4" />}
              clearButton
              onClearButtonClick={() => setSearchValue('')}
              autoComplete="off"
            />
          </Box>

          {error && (
            <Box padding="300">
              <Banner tone="critical" title="Unable to load products">
                <p>{error instanceof Error ? error.message : 'Something went wrong.'}</p>
              </Banner>
            </Box>
          )}

          {isLoading ? (
            <Box padding="800">
              <InlineStack align="center">
                <Spinner accessibilityLabel="Loading products" size="large" />
              </InlineStack>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: 'product', plural: 'products' }}
              itemCount={pageItems.length}
              selectable={false}
              headings={[
                { title: 'Product' },
                { title: 'Price' },
                { title: 'AI Desc' },
                { title: 'Images' },
                { title: 'eBay' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>

        <Box padding="400">
          <InlineStack align="center" gap="400">
            <Text tone="subdued" as="p">
              {sorted.length === 0
                ? 'No products match your filters'
                : `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, sorted.length)} of ${sorted.length}`}
            </Text>
            <Pagination
              hasPrevious={currentPage > 1}
              onPrevious={() => setPage((prev) => Math.max(1, prev - 1))}
              hasNext={currentPage < totalPages}
              onNext={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            />
          </InlineStack>
        </Box>
      </BlockStack>
    </Page>
  );
};

export default ShopifyProducts;
