import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Page,
  Layout,
  Card,
  Badge,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Box,
  Spinner,
  TextField,
  Banner,
  Modal,
  InlineGrid,
  Thumbnail,
  Checkbox,
} from '@shopify/polaris';
import {
  ExternalIcon,
  EditIcon,
  ViewIcon,
  CheckIcon,
  XSmallIcon,
  ArrowLeftIcon,
  RefreshIcon,
} from '@shopify/polaris-icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, useProductNotes, useSaveProductNotes } from '../hooks/useApi';
import { useAppStore } from '../store';
import ProductPhotoEditor from '../components/ProductPhotoEditor';
import DraggablePhotoGrid from '../components/DraggablePhotoGrid';
import ConditionBadge, { getConditionFromTags } from '../components/ConditionBadge';

// ── Types ──────────────────────────────────────────────────────────────

interface Draft {
  id: number;
  shopify_product_id: string;
  draft_title: string | null;
  draft_description: string | null;
  draft_images_json: string | null;
  original_title: string | null;
  original_description: string | null;
  original_images_json: string | null;
  status: string;
  auto_publish: number;
  created_at: number;
  updated_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  draftImages: string[];
  originalImages: string[];
  parsedTags: string[];
  ebay_listing_id?: string | null;
  ebay_offer_id?: string | null;
}

interface DraftListResponse {
  data: Draft[];
  total: number;
  limit: number;
  offset: number;
  pendingCount: number;
}

interface DraftDetailResponse {
  draft: Draft;
  live: {
    title: string;
    description: string;
    images: string[];
    hasPhotos: boolean;
    hasDescription: boolean;
  };
}

interface EbayListingPreview {
  sku: string;
  title: string;
  description: string;
  condition: string;
  conditionDescription?: string;
  categoryId: string;
  categoryName: string;
  price: string;
  currency: string;
  quantity: number;
  imageUrls: string[];
  brand: string;
  mpn: string;
  aspects: Record<string, string[]>;
  policies?: {
    fulfillmentPolicyId: string;
    fulfillmentPolicyName: string;
    paymentPolicyId: string;
    paymentPolicyName: string;
    returnPolicyId: string;
    returnPolicyName: string;
  };
  merchantLocationKey: string;
}

// ── Wizard Step ────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3;

// ── Step Indicator ─────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: 'Review Content' },
  { num: 2, label: 'Save to Shopify' },
  { num: 3, label: 'List on eBay' },
];

const StepIndicator: React.FC<{ currentStep: WizardStep }> = ({ currentStep }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      padding: '16px 20px',
      background: '#f6f6f7',
      borderRadius: '12px',
      marginBottom: '20px',
      border: '1px solid #e3e3e3',
    }}
  >
    {STEPS.map((step, idx) => {
      const isActive = step.num === currentStep;
      const isDone = step.num < currentStep;
      return (
        <React.Fragment key={step.num}>
          {idx > 0 && (
            <div
              style={{
                flex: 1,
                height: '2px',
                background: isDone ? '#008060' : '#e3e3e3',
                margin: '0 8px',
              }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                background: isActive ? '#008060' : isDone ? '#008060' : '#d0d0d0',
                color: isActive || isDone ? '#fff' : '#666',
                transition: 'background 0.2s',
              }}
            >
              {isDone ? '✓' : step.num}
            </div>
            <span
              style={{
                fontSize: '13px',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#008060' : isDone ? '#008060' : '#6d7175',
              }}
            >
              {step.label}
            </span>
          </div>
        </React.Fragment>
      );
    })}
  </div>
);

// ── Helpers ────────────────────────────────────────────────────────────

const statusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge tone="attention">Pending Review</Badge>;
    case 'approved':
      return <Badge tone="success">Approved</Badge>;
    case 'rejected':
      return <Badge tone="critical">Rejected</Badge>;
    case 'partial':
      return <Badge tone="warning">Partially Approved</Badge>;
    case 'listed':
      return <Badge tone="success">Listed on eBay</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

const formatDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  NEW_OTHER: 'New - Other',
  LIKE_NEW: 'Like New',
  USED_EXCELLENT: 'Excellent',
  VERY_GOOD: 'Very Good',
  GOOD: 'Good',
  ACCEPTABLE: 'Acceptable',
  FOR_PARTS_OR_NOT_WORKING: 'For Parts / Not Working',
};

// ── eBay Compact Preview ───────────────────────────────────────────────

const EbayCompactPreview: React.FC<{ preview: EbayListingPreview }> = ({ preview }) => {
  const [activeImg, setActiveImg] = useState(0);
  const priceNum = parseFloat(preview.price) || 0;
  const conditionLabel = CONDITION_LABELS[preview.condition] || preview.condition;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#fff',
      }}
    >
      {/* eBay header bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, #e53238 0%, #0064d3 100%)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 800, fontSize: '18px', letterSpacing: '-0.5px' }}>ebay</span>
        <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '11px' }}>Preview — not live yet</span>
      </div>

      <div style={{ padding: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111', margin: '0 0 10px 0', lineHeight: '1.3' }}>
          {preview.title || 'Untitled Product'}
        </h2>
        <div style={{ marginBottom: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              background: '#f0f7ff',
              color: '#0064d3',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              border: '1px solid #c8e0ff',
            }}
          >
            Condition: {conditionLabel}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
          {/* Photos */}
          <div style={{ flexShrink: 0, width: '200px' }}>
            {preview.imageUrls.length > 0 ? (
              <>
                <div
                  style={{
                    width: '200px',
                    height: '200px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    background: '#fafafa',
                    marginBottom: '6px',
                  }}
                >
                  <img
                    src={preview.imageUrls[activeImg]}
                    alt="Product"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                  {preview.imageUrls.slice(0, 6).map((url, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveImg(i)}
                      style={{
                        width: '36px',
                        height: '36px',
                        border: `2px solid ${i === activeImg ? '#0064d3' : '#e5e7eb'}`,
                        borderRadius: '3px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        background: '#fafafa',
                      }}
                    >
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  width: '200px',
                  height: '200px',
                  border: '1px dashed #d1d5db',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#9ca3af',
                  fontSize: '13px',
                }}
              >
                No photos
              </div>
            )}
          </div>

          {/* Price + info */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>
              US ${priceNum.toFixed(2)}
            </div>
            <div style={{ fontSize: '11px', color: '#555', marginBottom: '12px' }}>
              + Free shipping · Free returns
            </div>
            <div style={{ padding: '10px', background: '#f0f9f0', borderRadius: '6px', border: '1px solid #c3e6cb', marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1a7f37' }}>Add to cart</div>
              <div style={{ fontSize: '11px', color: '#555' }}>Ships from Salt Lake City, UT</div>
            </div>
            {preview.conditionDescription && (
              <div style={{ fontSize: '11px', color: '#555', fontStyle: 'italic' }}>
                "{preview.conditionDescription}"
              </div>
            )}
          </div>
        </div>

        {/* Item specifics */}
        {Object.entries(preview.aspects).length > 0 && (
          <>
            <Divider />
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#111', marginBottom: '8px' }}>Item specifics</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                {preview.brand && (
                  <React.Fragment key="brand">
                    <div style={{ fontSize: '12px', color: '#555' }}>Brand</div>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#111' }}>{preview.brand}</div>
                  </React.Fragment>
                )}
                {Object.entries(preview.aspects)
                  .slice(0, 6)
                  .map(([key, vals]) => (
                    <React.Fragment key={key}>
                      <div style={{ fontSize: '12px', color: '#555' }}>{key}</div>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: '#111' }}>
                        {Array.isArray(vals) ? vals.join(', ') : String(vals)}
                      </div>
                    </React.Fragment>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────

const ReviewDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const draftId = parseInt(id || '0');

  // ── Wizard State ─────────────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  // Step 1 editing state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [localDraftImages, setLocalDraftImages] = useState<string[]>([]);
  const [stateInitialized, setStateInitialized] = useState(false);

  // UI state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [editingPhotoIndex, setEditingPhotoIndex] = useState<number | null>(null);
  const [localNotes, setLocalNotes] = useState('');
  const [notesInit, setNotesInit] = useState(false);

  // Step 2 state
  const [shopifySuccess, setShopifySuccess] = useState(false);
  const [publishOnShopify, setPublishOnShopify] = useState(true);

  // Step 3 state
  const [ebayPreview, setEbayPreview] = useState<EbayListingPreview | null>(null);
  const [ebaySuccess, setEbaySuccess] = useState<{ listingId: string; ebayUrl: string } | null>(null);

  // ── Queue Navigation ─────────────────────────────────────────────────
  const { data: queueData } = useQuery({
    queryKey: ['drafts', 'pending', 'nav'],
    queryFn: () => apiClient.get<DraftListResponse>('/drafts?status=pending&limit=200&offset=0'),
    staleTime: 30000,
  });

  const queueIds = useMemo(() => queueData?.data?.map((d) => d.id) || [], [queueData]);
  const currentIndex = useMemo(() => queueIds.indexOf(draftId), [queueIds, draftId]);
  const prevId = currentIndex > 0 ? queueIds[currentIndex - 1] : null;
  const nextId = currentIndex >= 0 && currentIndex < queueIds.length - 1 ? queueIds[currentIndex + 1] : null;

  // ── Data Fetching ─────────────────────────────────────────────────────
  const { data: detailData, isLoading } = useQuery({
    queryKey: ['draft-detail', draftId],
    queryFn: () => apiClient.get<DraftDetailResponse>(`/drafts/${draftId}`),
    enabled: draftId > 0,
  });

  const draft = detailData?.draft;
  const live = detailData?.live;

  const productId = draft?.shopify_product_id;
  const { data: notesData } = useProductNotes(productId);
  const saveNotesMutation = useSaveProductNotes();

  // ── Initialize editing state from draft ───────────────────────────────
  useEffect(() => {
    if (draft && !stateInitialized) {
      setEditTitle(draft.draft_title || '');
      setEditDescription(draft.draft_description || '');
      const imgs = (draft.draftImages || []).filter((img) => img && img.startsWith('http'));
      setLocalDraftImages(imgs);
      setStateInitialized(true);
    }
  }, [draft, stateInitialized]);

  // Reset when navigating to a different draft
  useEffect(() => {
    setStateInitialized(false);
    setWizardStep(1);
    setShopifySuccess(false);
    setEbayPreview(null);
    setEbaySuccess(null);
    setNotesInit(false);
    setLocalNotes('');
  }, [draftId]);

  useEffect(() => {
    if (notesData?.notes !== undefined && !notesInit) {
      setLocalNotes(notesData.notes);
      setNotesInit(true);
    }
  }, [notesData, notesInit]);

  // ── Keyboard Navigation ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (wizardStep !== 1) return;
      if (e.key === 'ArrowLeft' && prevId) navigate(`/review/${prevId}`);
      if (e.key === 'ArrowRight' && nextId) navigate(`/review/${nextId}`);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevId, nextId, navigate, wizardStep]);

  // ── Mutations ─────────────────────────────────────────────────────────

  const rejectMutation = useMutation({
    mutationFn: () => apiClient.post(`/drafts/${draftId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      addNotification({ type: 'success', title: 'Draft rejected', autoClose: 4000 });
      if (nextId) navigate(`/review/${nextId}`, { replace: true });
      else navigate('/review', { replace: true });
    },
    onError: (err) => {
      addNotification({
        type: 'error',
        title: 'Reject failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (changes: { title?: string; description?: string; images?: string[] }) =>
      apiClient.put(`/drafts/${draftId}`, changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (newImages: string[]) => apiClient.put(`/drafts/${draftId}`, { images: newImages }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
    },
    onError: (err) => {
      addNotification({
        type: 'error',
        title: 'Photo save failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 6000,
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => apiClient.post(`/drafts/${draftId}/approve`, { photos: true, description: true, publish: publishOnShopify }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      queryClient.invalidateQueries({ queryKey: ['draft-detail'] });
      setShopifySuccess(true);
      addNotification({ type: 'success', title: 'Saved to Shopify!', message: 'Content pushed live', autoClose: 4000 });
      // Load eBay preview while user sees success
      ebayPreviewMutation.mutate();
      // Auto-advance to Step 3 after 1.5s
      setTimeout(() => setWizardStep(3), 1500);
    },
    onError: (err) => {
      addNotification({
        type: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });

  const ebayPreviewMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ success: boolean; preview?: EbayListingPreview; error?: string }>(
        `/drafts/${draftId}/preview-ebay-listing`,
      ),
    onSuccess: (data) => {
      if (data.preview) {
        setEbayPreview(data.preview);
      }
    },
  });

  const listOnEbayMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ success: boolean; listingId?: string; ebayUrl?: string; error?: string }>(
        `/drafts/${draftId}/list-on-ebay`,
        {},
      ),
    onSuccess: (data) => {
      if (data.success && data.listingId) {
        queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
        queryClient.invalidateQueries({ queryKey: ['drafts'] });
        setEbaySuccess({
          listingId: data.listingId,
          ebayUrl: data.ebayUrl || `https://www.ebay.com/itm/${data.listingId}`,
        });
        addNotification({ type: 'success', title: '🎉 Listed on eBay!', message: `Listing #${data.listingId}`, autoClose: 8000 });
      } else {
        addNotification({
          type: 'error',
          title: 'eBay listing failed',
          message: data.error || 'Unknown error',
          autoClose: 10000,
        });
      }
    },
    onError: (err) => {
      addNotification({
        type: 'error',
        title: 'eBay listing failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 10000,
      });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleReorderPhotos = useCallback(
    async (newImages: string[]): Promise<void> => {
      setLocalDraftImages(newImages);
      await reorderMutation.mutateAsync(newImages);
    },
    [reorderMutation],
  );

  const handleApproveContent = useCallback(async () => {
    // Save any edits to title/description before advancing
    const promises: Promise<any>[] = [];
    if (draft) {
      const titleChanged = editTitle !== (draft.draft_title || '');
      const descChanged = editDescription !== (draft.draft_description || '');
      if (titleChanged || descChanged) {
        promises.push(
          updateMutation.mutateAsync({
            title: editTitle,
            description: editDescription,
          }),
        );
      }
    }
    await Promise.all(promises);
    setWizardStep(2);
  }, [draft, editTitle, editDescription, updateMutation]);

  const handleSaveToShopify = useCallback(() => {
    approveMutation.mutate();
  }, [approveMutation]);

  const handleAdvanceToEbay = useCallback(() => {
    setWizardStep(3);
    if (!ebayPreview) {
      ebayPreviewMutation.mutate();
    }
  }, [ebayPreview, ebayPreviewMutation]);

  const handleSkipEbay = useCallback(() => {
    if (nextId) navigate(`/review/${nextId}`, { replace: true });
    else navigate('/review', { replace: true });
  }, [nextId, navigate]);

  const handleFinish = useCallback(() => {
    if (nextId) navigate(`/review/${nextId}`, { replace: true });
    else navigate('/review', { replace: true });
  }, [nextId, navigate]);

  // ── Loading State ─────────────────────────────────────────────────────

  if (isLoading || !draft || !live) {
    return (
      <Page backAction={{ content: 'Review Queue', url: '/review' }} title="Loading...">
        <Box padding="600">
          <InlineStack align="center">
            <Spinner size="large" />
          </InlineStack>
        </Box>
      </Page>
    );
  }

  const title = draft.draft_title || draft.original_title || `Product #${draft.shopify_product_id}`;
  const shopifyAdminUrl = `https://admin.shopify.com/store/pictureline/products/${draft.shopify_product_id}`;

  const draftImages = localDraftImages.length > 0
    ? localDraftImages
    : (draft.draftImages || []).filter((img) => img && img.startsWith('http'));
  const liveImages = (live.images || []).filter((img) => img && img.startsWith('http'));

  const tags = draft.parsedTags || [];
  const listingId = ebaySuccess?.listingId || draft.ebay_listing_id;

  // Non-pending drafts: show read-only view
  if (draft.status !== 'pending') {
    return (
      <>
        <Page
          backAction={{ content: 'Review Queue', url: '/review' }}
          title={title}
          titleMetadata={statusBadge(draft.status)}
          subtitle={`Created ${formatDate(draft.created_at)}${draft.reviewed_at ? ` · Reviewed ${formatDate(draft.reviewed_at)}` : ''}`}
        >
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h2">Photos</Text>
                    {tags.length > 0 && <ConditionBadge tags={tags} />}
                  </InlineStack>
                  {draftImages.length > 0 ? (
                    <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="200">
                      {draftImages.map((img, i) => (
                        <Card key={i} padding="200">
                          <BlockStack gap="200" inlineAlign="center">
                            <Thumbnail source={img} alt={`Photo ${i + 1}`} size="large" />
                            <Button variant="plain" icon={ViewIcon} onClick={() => setLightboxSrc(img)}>View</Button>
                          </BlockStack>
                        </Card>
                      ))}
                    </InlineGrid>
                  ) : (
                    <Banner tone="info"><Text as="p">No photos available.</Text></Banner>
                  )}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Description</Text>
                  <Card background="bg-surface-secondary" padding="300">
                    <Box><div dangerouslySetInnerHTML={{ __html: draft.draft_description || '<em>No description</em>' }} /></Box>
                  </Card>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Status</Text>
                  {statusBadge(draft.status)}
                  {draft.reviewed_at && (
                    <Text variant="bodySm" as="p" tone="subdued">Reviewed {formatDate(draft.reviewed_at)}</Text>
                  )}
                </BlockStack>
              </Card>
              {listingId && (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">eBay Listing</Text>
                      <Badge tone="success">Live</Badge>
                    </InlineStack>
                    <Badge tone="success">{`Listing #${listingId}`}</Badge>
                    <Button fullWidth icon={ExternalIcon} size="slim" url={ebaySuccess?.ebayUrl || `https://www.ebay.com/itm/${listingId}`} target="_blank">
                      View on eBay
                    </Button>
                  </BlockStack>
                </Card>
              )}
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Product Info</Text>
                  <Button fullWidth icon={ExternalIcon} size="slim" url={shopifyAdminUrl} target="_blank">View in Shopify</Button>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
        <Modal open={Boolean(lightboxSrc)} onClose={() => setLightboxSrc(null)} title="Photo preview" primaryAction={{ content: 'Close', onAction: () => setLightboxSrc(null) }}>
          <Modal.Section>
            <InlineStack align="center">{lightboxSrc ? <Thumbnail source={lightboxSrc} alt="Enlarged photo" size="large" /> : null}</InlineStack>
          </Modal.Section>
        </Modal>
      </>
    );
  }

  // ── WIZARD RENDER ──────────────────────────────────────────────────────

  return (
    <>
      <Page
        backAction={{ content: 'Review Queue', url: '/review' }}
        title={title}
        titleMetadata={statusBadge(draft.status)}
        subtitle={`Created ${formatDate(draft.created_at)}`}
        pagination={
          queueIds.length > 0 && wizardStep === 1
            ? {
                hasPrevious: prevId !== null,
                hasNext: nextId !== null,
                onPrevious: () => prevId && navigate(`/review/${prevId}`),
                onNext: () => nextId && navigate(`/review/${nextId}`),
                label: `${currentIndex + 1} of ${queueIds.length}`,
              }
            : undefined
        }
      >
        <StepIndicator currentStep={wizardStep} />

        {/* ══════════════════════════════════════════════════════════════
            STEP 1: Review AI Content
            ══════════════════════════════════════════════════════════════ */}
        {wizardStep === 1 && (
          <Layout>
            <Layout.Section>
              {/* Condition Badge Banner */}
              {tags.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <Card>
                    <InlineStack gap="300" blockAlign="center">
                      <Text variant="headingSm" as="h3">Condition from TIM:</Text>
                      <ConditionBadge tags={tags} />
                      <Text variant="bodySm" as="p" tone="subdued">
                        {(() => {
                          const c = getConditionFromTags(tags);
                          return c ? c.label : tags.filter((t) => t.startsWith('condition-')).join(', ');
                        })()}
                      </Text>
                    </InlineStack>
                  </Card>
                </div>
              )}

              {/* Photos Card */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">Photos</Text>
                    <Badge>{`${draftImages.length} draft${liveImages.length > 0 ? ` · ${liveImages.length} live` : ''}`}</Badge>
                  </InlineStack>

                  {draftImages.length === 0 && liveImages.length === 0 ? (
                    <Banner tone="info"><Text as="p">No photos available for this draft.</Text></Banner>
                  ) : draftImages.length > 0 && liveImages.length > 0 ? (
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="600">
                      <BlockStack gap="300">
                        <Text variant="headingSm" as="h3" tone="subdued">✨ New Draft Photos</Text>
                        <DraggablePhotoGrid
                          imageUrls={draftImages}
                          onChange={handleReorderPhotos}
                          onEditPhoto={(i) => setEditingPhotoIndex(i)}
                          enableBulkEdit
                          draftId={draftId}
                        />
                      </BlockStack>
                      <BlockStack gap="300">
                        <Text variant="headingSm" as="h3" tone="subdued">📷 Current Live Photos</Text>
                        <InlineGrid columns={{ xs: 2, sm: 2 }} gap="200">
                          {liveImages.map((img, i) => (
                            <Card key={`live-${i}`} padding="200">
                              <BlockStack gap="200" inlineAlign="center">
                                <Thumbnail source={img} alt={`Live photo ${i + 1}`} size="large" />
                                <Button variant="plain" icon={ViewIcon} onClick={() => setLightboxSrc(img)}>View</Button>
                              </BlockStack>
                            </Card>
                          ))}
                        </InlineGrid>
                      </BlockStack>
                    </InlineGrid>
                  ) : draftImages.length > 0 ? (
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3" tone="subdued">✨ New Draft Photos — drag to reorder</Text>
                      <DraggablePhotoGrid
                        imageUrls={draftImages}
                        onChange={handleReorderPhotos}
                        onEditPhoto={(i) => setEditingPhotoIndex(i)}
                        enableBulkEdit
                        draftId={draftId}
                      />
                    </BlockStack>
                  ) : (
                    <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="200">
                      {liveImages.map((img, i) => (
                        <Card key={i} padding="200">
                          <BlockStack gap="200" inlineAlign="center">
                            <Thumbnail source={img} alt={`Live photo ${i + 1}`} size="large" />
                            <Button variant="plain" icon={ViewIcon} onClick={() => setLightboxSrc(img)}>View</Button>
                          </BlockStack>
                        </Card>
                      ))}
                    </InlineGrid>
                  )}
                </BlockStack>
              </Card>

              {/* Title Card */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Title</Text>
                  {draft.original_title && draft.original_title !== editTitle && (
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3" tone="subdued">📄 Original Title</Text>
                      <Card background="bg-surface-secondary" padding="300">
                        <Text as="p">{draft.original_title}</Text>
                      </Card>
                    </BlockStack>
                  )}
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h3" tone="subdued">✨ AI-Generated Title</Text>
                    <TextField
                      label=""
                      labelHidden
                      value={editTitle}
                      onChange={setEditTitle}
                      autoComplete="off"
                      placeholder="Product title"
                    />
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Description Card */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Description</Text>

                  {live.description ? (
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3" tone="subdued">📄 Current Live Description</Text>
                        <Card background="bg-surface-secondary" padding="300">
                          <Box>
                            <div
                              style={{ maxHeight: '400px', overflow: 'auto', fontSize: '13px', lineHeight: '1.6' }}
                              dangerouslySetInnerHTML={{ __html: live.description }}
                            />
                          </Box>
                        </Card>
                      </BlockStack>
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3" tone="subdued">✨ AI-Generated Description</Text>
                        <TextField
                          label=""
                          labelHidden
                          value={editDescription}
                          onChange={setEditDescription}
                          multiline={14}
                          autoComplete="off"
                        />
                      </BlockStack>
                    </InlineGrid>
                  ) : (
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3" tone="subdued">✨ AI-Generated Description</Text>
                      <TextField
                        label=""
                        labelHidden
                        value={editDescription}
                        onChange={setEditDescription}
                        multiline={12}
                        autoComplete="off"
                      />
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Right sidebar */}
            <Layout.Section variant="oneThird">
              <div style={{ position: 'sticky', top: '16px' }}>
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Step 1 Actions</Text>

                    {tags.length > 0 && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" as="p" tone="subdued">Condition Grade</Text>
                        <ConditionBadge tags={tags} />
                      </BlockStack>
                    )}

                    <Divider />

                    <Button
                      variant="primary"
                      tone="success"
                      size="large"
                      fullWidth
                      icon={CheckIcon}
                      onClick={handleApproveContent}
                      loading={updateMutation.isPending}
                    >
                      Approve Content →
                    </Button>
                    <Text variant="bodySm" as="p" tone="subdued" alignment="center">
                      Advances to Shopify preview
                    </Text>

                    <Divider />

                    <Button
                      fullWidth
                      tone="critical"
                      icon={XSmallIcon}
                      onClick={() => rejectMutation.mutate()}
                      loading={rejectMutation.isPending}
                    >
                      Reject Draft
                    </Button>
                  </BlockStack>
                </Card>

                {/* Product Info */}
                <div style={{ marginTop: '16px' }}>
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h2">Product Info</Text>
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text variant="bodySm" as="span" tone="subdued">Shopify ID</Text>
                          <Text variant="bodySm" as="span">{draft.shopify_product_id}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text variant="bodySm" as="span" tone="subdued">Photos</Text>
                          <Text variant="bodySm" as="span">{draftImages.length} draft</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text variant="bodySm" as="span" tone="subdued">Description</Text>
                          <Badge tone={draft.draft_description ? 'success' : 'critical'}>
                            {draft.draft_description ? 'Generated' : 'Missing'}
                          </Badge>
                        </InlineStack>
                      </BlockStack>
                      <Button fullWidth icon={ExternalIcon} size="slim" url={shopifyAdminUrl} target="_blank">
                        View in Shopify
                      </Button>
                    </BlockStack>
                  </Card>
                </div>

                {/* Notes */}
                {productId && (
                  <div style={{ marginTop: '16px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" as="h2">Notes</Text>
                          {localNotes.trim() && <Badge tone="attention">Has Notes</Badge>}
                        </InlineStack>
                        <TextField
                          label=""
                          labelHidden
                          value={localNotes}
                          onChange={setLocalNotes}
                          multiline={3}
                          placeholder="Condition notes, blemishes, etc."
                          autoComplete="off"
                          onBlur={() => {
                            if (localNotes !== (notesData?.notes ?? '')) {
                              saveNotesMutation.mutate({ productId, notes: localNotes });
                            }
                          }}
                        />
                        <Text variant="bodySm" as="p" tone="subdued">Auto-saves on blur.</Text>
                      </BlockStack>
                    </Card>
                  </div>
                )}
              </div>
            </Layout.Section>
          </Layout>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STEP 2: Preview & Save to Shopify
            ══════════════════════════════════════════════════════════════ */}
        {wizardStep === 2 && (
          <Layout>
            <Layout.Section>
              {shopifySuccess ? (
                <Banner tone="success">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h2">✅ Saved to Shopify!</Text>
                    <Text as="p">Title, description, and photos have been pushed to your Shopify product.</Text>
                  </BlockStack>
                </Banner>
              ) : (
                <Banner tone="info">
                  <Text as="p">
                    Review the content below. This is exactly what will be pushed to Shopify when you click "Save to Shopify".
                  </Text>
                </Banner>
              )}

              {/* Preview: Photos */}
              <div style={{ marginTop: '16px' }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">Photos to Publish</Text>
                      <Badge tone={draftImages.length > 0 ? 'success' : 'critical'}>
                        {`${draftImages.length} photo${draftImages.length !== 1 ? 's' : ''}`}
                      </Badge>
                    </InlineStack>
                    {draftImages.length > 0 ? (
                      <InlineGrid columns={{ xs: 3, sm: 4, md: 5 }} gap="200">
                        {draftImages.map((img, i) => (
                          <div key={i} style={{ position: 'relative' }}>
                            <Card padding="200">
                              <BlockStack gap="100" inlineAlign="center">
                                <Thumbnail source={img} alt={`Photo ${i + 1}`} size="large" />
                                {i === 0 && (
                                  <Badge tone="success">Main</Badge>
                                )}
                              </BlockStack>
                            </Card>
                          </div>
                        ))}
                      </InlineGrid>
                    ) : (
                      <Banner tone="warning"><Text as="p">No photos to publish.</Text></Banner>
                    )}
                  </BlockStack>
                </Card>
              </div>

              {/* Preview: Title */}
              <div style={{ marginTop: '16px' }}>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">Title to Publish</Text>
                    <Card background="bg-surface-secondary" padding="300">
                      <Text as="p" fontWeight="semibold">{editTitle || draft.draft_title || '(no title)'}</Text>
                    </Card>
                  </BlockStack>
                </Card>
              </div>

              {/* Preview: Description */}
              <div style={{ marginTop: '16px' }}>
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">Description to Publish</Text>
                      {tags.length > 0 && <ConditionBadge tags={tags} />}
                    </InlineStack>
                    <Card background="bg-surface-secondary" padding="300">
                      <Box>
                        <div
                          style={{ maxHeight: '500px', overflow: 'auto' }}
                          dangerouslySetInnerHTML={{ __html: editDescription || draft.draft_description || '<em>No description</em>' }}
                        />
                      </Box>
                    </Card>
                  </BlockStack>
                </Card>
              </div>
            </Layout.Section>

            {/* Right sidebar */}
            <Layout.Section variant="oneThird">
              <div style={{ position: 'sticky', top: '16px' }}>
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Step 2: Save to Shopify</Text>

                    {tags.length > 0 && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" as="p" tone="subdued">Condition Grade</Text>
                        <ConditionBadge tags={tags} />
                      </BlockStack>
                    )}

                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" as="span" tone="subdued">Photos</Text>
                        <Text variant="bodySm" as="span">{draftImages.length} to upload</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodySm" as="span" tone="subdued">Title</Text>
                        <Badge tone="success">Ready</Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodySm" as="span" tone="subdued">Description</Text>
                        <Badge tone={editDescription ? 'success' : 'warning'}>{editDescription ? 'Ready' : 'Empty'}</Badge>
                      </InlineStack>
                    </BlockStack>

                    <Divider />

                    {!shopifySuccess ? (
                      <BlockStack gap="300">
                        <Checkbox
                          label="Publish on Shopify"
                          helpText="Make this product visible in your store"
                          checked={publishOnShopify}
                          onChange={setPublishOnShopify}
                        />
                        <Button
                          variant="primary"
                          tone="success"
                          size="large"
                          fullWidth
                          onClick={handleSaveToShopify}
                          loading={approveMutation.isPending}
                          icon={CheckIcon}
                        >
                          Save to Shopify
                        </Button>
                      </BlockStack>
                    ) : (
                      <Text variant="bodyMd" as="p" tone="success" fontWeight="semibold">
                        ✅ Saved to Shopify — advancing to eBay…
                      </Text>
                    )}

                    {shopifySuccess && (
                      <Button fullWidth variant="plain" url={shopifyAdminUrl} target="_blank" icon={ExternalIcon}>
                        View in Shopify
                      </Button>
                    )}

                    <Divider />

                    <Button
                      fullWidth
                      icon={ArrowLeftIcon}
                      onClick={() => setWizardStep(1)}
                      disabled={approveMutation.isPending}
                    >
                      ← Back to Review
                    </Button>
                  </BlockStack>
                </Card>
              </div>
            </Layout.Section>
          </Layout>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STEP 3: Preview & List on eBay
            ══════════════════════════════════════════════════════════════ */}
        {wizardStep === 3 && (
          <Layout>
            <Layout.Section>
              {ebaySuccess ? (
                <BlockStack gap="400">
                  <Banner tone="success">
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h2">🎉 Listed on eBay!</Text>
                      <Text as="p">Your product is now live on eBay.</Text>
                      <InlineStack gap="200">
                        <Badge tone="success">{`Listing #${ebaySuccess.listingId}`}</Badge>
                      </InlineStack>
                    </BlockStack>
                  </Banner>
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      icon={ExternalIcon}
                      url={ebaySuccess.ebayUrl}
                      target="_blank"
                    >
                      View on eBay
                    </Button>
                    <Button onClick={handleFinish}>
                      {nextId ? 'Next Draft →' : 'Back to Queue'}
                    </Button>
                  </InlineStack>
                </BlockStack>
              ) : (
                <BlockStack gap="400">
                  <Banner tone="info">
                    <Text as="p">
                      Review the eBay listing preview below. Click "Publish to eBay" to go live, or use "Edit Listing Details" for full control over price, category, and item specifics.
                    </Text>
                  </Banner>

                  {ebayPreviewMutation.isPending && !ebayPreview ? (
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="center">
                          <Spinner size="large" />
                        </InlineStack>
                        <Text alignment="center" as="p" tone="subdued">Loading eBay listing data…</Text>
                      </BlockStack>
                    </Card>
                  ) : ebayPreview ? (
                    <BlockStack gap="400">
                      {/* eBay Preview Card */}
                      <EbayCompactPreview preview={ebayPreview} />

                      {/* Condition Info */}
                      {tags.length > 0 && (
                        <Card>
                          <BlockStack gap="300">
                            <Text variant="headingMd" as="h2">Condition Details</Text>
                            <InlineStack gap="300" blockAlign="center">
                              <ConditionBadge tags={tags} />
                              {ebayPreview.conditionDescription && (
                                <Text variant="bodySm" as="p" tone="subdued">
                                  "{ebayPreview.conditionDescription}"
                                </Text>
                              )}
                            </InlineStack>
                            <BlockStack gap="100">
                              <Text variant="bodySm" as="span" tone="subdued">eBay Condition Grade</Text>
                              <Text variant="bodySm" as="span" fontWeight="semibold">
                                {CONDITION_LABELS[ebayPreview.condition] || ebayPreview.condition}
                              </Text>
                            </BlockStack>
                          </BlockStack>
                        </Card>
                      )}
                    </BlockStack>
                  ) : ebayPreviewMutation.isError ? (
                    <Banner tone="warning">
                      <BlockStack gap="200">
                        <Text as="p">Could not load eBay preview. You can still publish, or use the full prep page for more control.</Text>
                        <Button
                          icon={RefreshIcon}
                          onClick={() => ebayPreviewMutation.mutate()}
                          size="slim"
                        >
                          Retry
                        </Button>
                      </BlockStack>
                    </Banner>
                  ) : null}
                </BlockStack>
              )}
            </Layout.Section>

            {/* Right sidebar */}
            <Layout.Section variant="oneThird">
              <div style={{ position: 'sticky', top: '16px' }}>
                {!ebaySuccess ? (
                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h2">Step 3: List on eBay</Text>

                      {tags.length > 0 && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" as="p" tone="subdued">Condition Grade</Text>
                          <ConditionBadge tags={tags} />
                        </BlockStack>
                      )}

                      {ebayPreview && (
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <Text variant="bodySm" as="span" tone="subdued">Price</Text>
                            <Text variant="bodySm" as="span" fontWeight="semibold">${ebayPreview.price}</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodySm" as="span" tone="subdued">Condition</Text>
                            <Text variant="bodySm" as="span">{CONDITION_LABELS[ebayPreview.condition] || ebayPreview.condition}</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodySm" as="span" tone="subdued">Photos</Text>
                            <Text variant="bodySm" as="span">{ebayPreview.imageUrls.length} images</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodySm" as="span" tone="subdued">Category</Text>
                            <Text variant="bodySm" as="span">{ebayPreview.categoryName || ebayPreview.categoryId}</Text>
                          </InlineStack>
                        </BlockStack>
                      )}

                      <Divider />

                      <Button
                        variant="primary"
                        tone="success"
                        size="large"
                        fullWidth
                        onClick={() => listOnEbayMutation.mutate()}
                        loading={listOnEbayMutation.isPending}
                        disabled={listOnEbayMutation.isPending}
                      >
                        🛍️ Publish to eBay
                      </Button>

                      <Button
                        fullWidth
                        icon={EditIcon}
                        url={`/review/${draftId}/ebay-prep`}
                        disabled={listOnEbayMutation.isPending}
                      >
                        Edit Listing Details
                      </Button>

                      <Divider />

                      <Button
                        fullWidth
                        variant="plain"
                        onClick={handleSkipEbay}
                        disabled={listOnEbayMutation.isPending}
                      >
                        Skip eBay — Finish
                      </Button>

                      <Button
                        fullWidth
                        icon={ArrowLeftIcon}
                        onClick={() => setWizardStep(2)}
                        disabled={listOnEbayMutation.isPending}
                      >
                        ← Back
                      </Button>
                    </BlockStack>
                  </Card>
                ) : (
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" as="h2">eBay Listing</Text>
                        <Badge tone="success">Live</Badge>
                      </InlineStack>
                      <Badge tone="success">{`Listing #${ebaySuccess.listingId}`}</Badge>
                      <Button fullWidth icon={ExternalIcon} url={ebaySuccess.ebayUrl} target="_blank">View on eBay</Button>
                      <Button fullWidth variant="primary" onClick={handleFinish}>
                        {nextId ? 'Next Draft →' : 'Back to Queue'}
                      </Button>
                    </BlockStack>
                  </Card>
                )}
              </div>
            </Layout.Section>
          </Layout>
        )}
      </Page>

      {/* ── Lightbox Modal ── */}
      <Modal
        open={Boolean(lightboxSrc)}
        onClose={() => setLightboxSrc(null)}
        title="Photo preview"
        primaryAction={{ content: 'Close', onAction: () => setLightboxSrc(null) }}
      >
        <Modal.Section>
          <InlineStack align="center">
            {lightboxSrc ? <Thumbnail source={lightboxSrc} alt="Enlarged photo" size="large" /> : null}
          </InlineStack>
        </Modal.Section>
      </Modal>

      {/* ── Photo Editor ── */}
      {editingPhotoIndex !== null && draft && (
        <ProductPhotoEditor
          open={editingPhotoIndex !== null}
          imageUrl={draftImages[editingPhotoIndex]}
          draftId={draftId}
          imageIndex={editingPhotoIndex}
          allDraftImages={draftImages}
          onSave={() => {
            queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
            setEditingPhotoIndex(null);
            addNotification({ type: 'success', title: 'Photo updated', message: 'Edited photo saved', autoClose: 4000 });
          }}
          onClose={() => setEditingPhotoIndex(null)}
          productId={draft.shopify_product_id}
        />
      )}
    </>
  );
};

export default ReviewDetail;
