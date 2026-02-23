import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Page,
  Layout,
  Card,
  Badge,
  Button,
  ButtonGroup,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Box,
  Spinner,
  TextField,
  Pagination,
  Banner,
  Tooltip,
  Icon,
} from '@shopify/polaris';
import {
  ArrowLeftIcon,
  ExternalIcon,
  EditIcon,
  CheckIcon,
  XIcon,
  NoteIcon,
  ImageIcon,
} from '@shopify/polaris-icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, useProductNotes, useSaveProductNotes } from '../hooks/useApi';
import { useAppStore } from '../store';
import ProductPhotoEditor from '../components/ProductPhotoEditor';

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

// ── Lightbox Component ─────────────────────────────────────────────────

const Lightbox: React.FC<{ src: string; alt: string; onClose: () => void }> = ({ src, alt, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 999999,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'zoom-out',
    }}
  >
    <img
      src={src}
      alt={alt}
      style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', objectFit: 'contain' }}
    />
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────

const ReviewDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const draftId = parseInt(id || '0');

  const [isEditing, setIsEditing] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Notes state
  const [localNotes, setLocalNotes] = useState('');
  const [notesInit, setNotesInit] = useState(false);

  // Photo editor state
  const [editingPhotoIndex, setEditingPhotoIndex] = useState<number | null>(null);

  // eBay listing confirmation state
  const [showEbayConfirm, setShowEbayConfirm] = useState(false);

  // ── Fetch queue list for prev/next navigation ──────────────────────

  const { data: queueData } = useQuery({
    queryKey: ['drafts', 'pending', 'nav'],
    queryFn: () => apiClient.get<DraftListResponse>('/drafts?status=pending&limit=200&offset=0'),
    staleTime: 30000,
  });

  const queueIds = useMemo(() => queueData?.data?.map((d) => d.id) || [], [queueData]);
  const currentIndex = useMemo(() => queueIds.indexOf(draftId), [queueIds, draftId]);
  const prevId = currentIndex > 0 ? queueIds[currentIndex - 1] : null;
  const nextId = currentIndex >= 0 && currentIndex < queueIds.length - 1 ? queueIds[currentIndex + 1] : null;

  // ── Fetch draft detail ─────────────────────────────────────────────

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['draft-detail', draftId],
    queryFn: () => apiClient.get<DraftDetailResponse>(`/drafts/${draftId}`),
    enabled: draftId > 0,
  });

  const draft = detailData?.draft;
  const live = detailData?.live;

  // ── Product notes ──────────────────────────────────────────────────

  const productId = draft?.shopify_product_id;
  const { data: notesData } = useProductNotes(productId);
  const saveNotesMutation = useSaveProductNotes();

  useEffect(() => {
    if (notesData?.notes !== undefined && !notesInit) {
      setLocalNotes(notesData.notes);
      setNotesInit(true);
    }
  }, [notesData, notesInit]);

  // Reset notes init when navigating to different draft
  useEffect(() => {
    setNotesInit(false);
    setLocalNotes('');
    setIsEditing(false);
  }, [draftId]);

  // ── Mutations ──────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: ({ photos, description }: { photos: boolean; description: boolean }) =>
      apiClient.post(`/drafts/${draftId}/approve`, { photos, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      queryClient.invalidateQueries({ queryKey: ['draft-detail'] });
      addNotification({ type: 'success', title: 'Draft approved', message: 'Changes pushed to Shopify', autoClose: 4000 });
      // Auto-advance to next
      if (nextId) {
        navigate(`/review/${nextId}`, { replace: true });
      } else {
        navigate('/review', { replace: true });
      }
    },
    onError: (err) => {
      addNotification({ type: 'error', title: 'Approve failed', message: err instanceof Error ? err.message : 'Unknown error', autoClose: 8000 });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiClient.post(`/drafts/${draftId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      addNotification({ type: 'success', title: 'Draft rejected', autoClose: 4000 });
      if (nextId) {
        navigate(`/review/${nextId}`, { replace: true });
      } else {
        navigate('/review', { replace: true });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ description }: { description: string }) =>
      apiClient.put(`/drafts/${draftId}`, { description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
      setIsEditing(false);
      addNotification({ type: 'success', title: 'Draft updated', autoClose: 3000 });
    },
  });

  const previewEbayMutation = useMutation({
    mutationFn: () => apiClient.post(`/drafts/${draftId}/preview-ebay-listing`),
    onSuccess: (data) => {
      addNotification({ 
        type: 'info', 
        title: 'eBay Preview Generated', 
        message: `Would create: ${data.preview.title} - $${data.preview.price}`,
        autoClose: 6000 
      });
    },
    onError: (err) => {
      addNotification({ 
        type: 'error', 
        title: 'Preview failed', 
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 8000 
      });
    },
  });

  const listOnEbayMutation = useMutation({
    mutationFn: () => apiClient.post(`/drafts/${draftId}/list-on-ebay`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      queryClient.invalidateQueries({ queryKey: ['draft-detail'] });
      addNotification({ 
        type: 'success', 
        title: '🎉 Listed on eBay!', 
        message: `Created listing ${data.listingId} - $${data.price}`,
        autoClose: 8000 
      });
      // Auto-advance to next
      if (nextId) {
        navigate(`/review/${nextId}`, { replace: true });
      } else {
        navigate('/review', { replace: true });
      }
    },
    onError: (err) => {
      addNotification({ 
        type: 'error', 
        title: 'eBay listing failed', 
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 10000 
      });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────

  const handleStartEdit = useCallback(() => {
    setEditDescription(draft?.draft_description || '');
    setIsEditing(true);
  }, [draft]);

  const handleSaveEdit = useCallback(() => {
    updateMutation.mutate({ description: editDescription });
  }, [editDescription, updateMutation]);

  const handleSkip = useCallback(() => {
    if (nextId) {
      navigate(`/review/${nextId}`);
    } else {
      navigate('/review');
    }
  }, [nextId, navigate]);

  // ── Keyboard navigation ────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditing) return;
      if (e.key === 'ArrowLeft' && prevId) navigate(`/review/${prevId}`);
      if (e.key === 'ArrowRight' && nextId) navigate(`/review/${nextId}`);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevId, nextId, navigate, isEditing]);

  // ── Loading / Error states ─────────────────────────────────────────

  if (isLoading || !draft || !live) {
    return (
      <Page
        backAction={{ content: 'Review Queue', url: '/review' }}
        title="Loading..."
      >
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  const title = draft.draft_title || draft.original_title || `Product #${draft.shopify_product_id}`;
  const shopifyAdminUrl = `https://admin.shopify.com/store/pictureline/products/${draft.shopify_product_id}`;

  // Parse images - ensure we have valid URLs
  const draftImages = (draft.draftImages || []).filter((img) => img && img.startsWith('http'));
  const originalImages = (draft.originalImages || []).filter((img) => img && img.startsWith('http'));
  const liveImages = (live.images || []).filter((img) => img && img.startsWith('http'));

  return (
    <>
      {lightboxSrc && <Lightbox src={lightboxSrc} alt="Enlarged photo" onClose={() => setLightboxSrc(null)} />}

      <Page
        backAction={{ content: 'Review Queue', url: '/review' }}
        title={title}
        titleMetadata={statusBadge(draft.status)}
        subtitle={`Created ${formatDate(draft.created_at)}${draft.reviewed_at ? ` · Reviewed ${formatDate(draft.reviewed_at)}` : ''}`}
        pagination={
          queueIds.length > 0
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
        <Layout>
          {/* ── Left Column ─────────────────────────────────────────── */}
          <Layout.Section>
            {/* Photos Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Photos
                  </Text>
                  <Badge>
                    {`${draftImages.length} draft${liveImages.length > 0 ? ` · ${liveImages.length} live` : ''}`}
                  </Badge>
                </InlineStack>

                {draftImages.length === 0 && liveImages.length === 0 ? (
                  <Banner tone="info">
                    <p>No photos available for this draft.</p>
                  </Banner>
                ) : draftImages.length > 0 && liveImages.length > 0 ? (
                  /* Side-by-side before/after */
                  <>
                    <Text variant="headingSm" as="h3" tone="subdued">Draft Photos (New)</Text>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                      {draftImages.map((img, i) => (
                        <div
                          key={`draft-${i}`}
                          style={{
                            position: 'relative',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '2px solid #e3e5e7',
                            aspectRatio: '1',
                          }}
                        >
                          <img
                            src={img}
                            alt={`Draft photo ${i + 1}`}
                            onClick={() => setLightboxSrc(img)}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
                          />
                          {draft.status === 'pending' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingPhotoIndex(i); }}
                              style={{
                                position: 'absolute',
                                bottom: '8px',
                                right: '8px',
                                background: 'rgba(0,0,0,0.7)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title="Edit photo position/rotation"
                            >
                              ✏️ Edit
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <Divider />
                    <Text variant="headingSm" as="h3" tone="subdued">Current Live Photos</Text>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                      {liveImages.map((img, i) => (
                        <div
                          key={`live-${i}`}
                          onClick={() => setLightboxSrc(img)}
                          style={{
                            cursor: 'zoom-in',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '2px solid #e3e5e7',
                            opacity: 0.7,
                            aspectRatio: '1',
                          }}
                        >
                          <img
                            src={img}
                            alt={`Live photo ${i + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  /* Only one set of images */
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    {(draftImages.length > 0 ? draftImages : liveImages).map((img, i) => (
                      <div
                        key={i}
                        style={{
                          position: 'relative',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '2px solid #e3e5e7',
                          aspectRatio: '1',
                        }}
                      >
                        <img
                          src={img}
                          alt={`Photo ${i + 1}`}
                          onClick={() => setLightboxSrc(img)}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
                        />
                        {draft.status === 'pending' && draftImages.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingPhotoIndex(i); }}
                            style={{
                              position: 'absolute',
                              bottom: '8px',
                              right: '8px',
                              background: 'rgba(0,0,0,0.7)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '4px 10px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="Edit photo position/rotation"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </BlockStack>
            </Card>

            <div style={{ marginTop: '16px' }} />

            {/* AI Description Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">AI Description</Text>
                  {draft.status === 'pending' && !isEditing && (
                    <Button icon={EditIcon} onClick={handleStartEdit} size="slim">
                      Edit
                    </Button>
                  )}
                </InlineStack>

                {isEditing ? (
                  <BlockStack gap="300">
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={12}
                      style={{
                        width: '100%',
                        padding: '12px',
                        fontSize: '14px',
                        lineHeight: '1.6',
                        borderRadius: '8px',
                        border: '1px solid #c9cccf',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                      }}
                    />
                    <InlineStack gap="200">
                      <Button variant="primary" onClick={handleSaveEdit} loading={updateMutation.isPending}>
                        Save Changes
                      </Button>
                      <Button onClick={() => setIsEditing(false)}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <div
                    style={{
                      fontSize: '14px',
                      lineHeight: '1.6',
                      padding: '12px',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #e3e5e7',
                      maxHeight: '500px',
                      overflow: 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: draft.draft_description || '<em>No description</em>' }}
                  />
                )}

                {/* Show original/live description for comparison */}
                {live.description && (
                  <>
                    <Divider />
                    <Text variant="headingSm" as="h3" tone="subdued">Current Live Description</Text>
                    <div
                      style={{
                        fontSize: '13px',
                        lineHeight: '1.5',
                        padding: '12px',
                        background: '#fff',
                        borderRadius: '8px',
                        border: '1px solid #e3e5e7',
                        maxHeight: '300px',
                        overflow: 'auto',
                        opacity: 0.7,
                      }}
                      dangerouslySetInnerHTML={{ __html: live.description }}
                    />
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Right Column ────────────────────────────────────────── */}
          <Layout.Section variant="oneThird">
            {/* Actions Card */}
            {draft.status === 'pending' && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Actions</Text>
                  
                  {/* eBay Listing Section */}
                  <div style={{ padding: '12px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3">🚀 List on eBay</Text>
                      {showEbayConfirm ? (
                        <BlockStack gap="200">
                          <Text variant="bodySm" as="p" tone="subdued">
                            This will create a live eBay listing immediately. Make sure the description and photos are ready.
                          </Text>
                          <InlineStack gap="200">
                            <Button
                              variant="primary" 
                              tone="success"
                              onClick={() => {
                                setShowEbayConfirm(false);
                                listOnEbayMutation.mutate();
                              }}
                              loading={listOnEbayMutation.isPending}
                              size="slim"
                            >
                              ✓ Create Listing
                            </Button>
                            <Button 
                              onClick={() => setShowEbayConfirm(false)}
                              size="slim"
                            >
                              Cancel
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      ) : (
                        <InlineStack gap="200">
                          <Button
                            fullWidth
                            variant="primary"
                            tone="success"
                            onClick={() => setShowEbayConfirm(true)}
                            disabled={listOnEbayMutation.isPending || previewEbayMutation.isPending}
                          >
                            🎯 Approve & List on eBay
                          </Button>
                          <Tooltip content="See what would be created">
                            <Button
                              onClick={() => previewEbayMutation.mutate()}
                              loading={previewEbayMutation.isPending}
                              size="slim"
                            >
                              👁 Preview
                            </Button>
                          </Tooltip>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </div>

                  <Divider />

                  {/* Standard Shopify Approval */}
                  <Text variant="headingSm" as="h3" tone="subdued">Shopify Only</Text>
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    onClick={() => approveMutation.mutate({ photos: true, description: true })}
                    loading={approveMutation.isPending}
                  >
                    ✓ Approve All
                  </Button>
                  <InlineStack gap="200">
                    <div style={{ flex: 1 }}>
                      <Button
                        fullWidth
                        size="slim"
                        onClick={() => approveMutation.mutate({ photos: true, description: false })}
                      >
                        Photos Only
                      </Button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Button
                        fullWidth
                        size="slim"
                        onClick={() => approveMutation.mutate({ photos: false, description: true })}
                      >
                        Description Only
                      </Button>
                    </div>
                  </InlineStack>
                  
                  <Divider />
                  
                  <Button fullWidth onClick={handleSkip}>
                    Skip →
                  </Button>
                  <Button
                    fullWidth
                    tone="critical"
                    onClick={() => rejectMutation.mutate()}
                    loading={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                </BlockStack>
              </Card>
            )}

            {draft.status !== 'pending' && (
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Status</Text>
                  {statusBadge(draft.status)}
                  {draft.reviewed_at && (
                    <Text variant="bodySm" as="p" tone="subdued">
                      Reviewed {formatDate(draft.reviewed_at)}
                    </Text>
                  )}
                </BlockStack>
              </Card>
            )}

            <div style={{ marginTop: '16px' }} />

            {/* Product Info Card */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Product Info</Text>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span" tone="subdued">Shopify ID</Text>
                    <Text variant="bodySm" as="span">{draft.shopify_product_id}</Text>
                  </InlineStack>
                  {draft.draft_title && (
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Title</Text>
                      <Text variant="bodySm" as="span">{draft.draft_title}</Text>
                    </InlineStack>
                  )}
                </BlockStack>
                <a
                  href={shopifyAdminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <Button fullWidth icon={ExternalIcon} size="slim">
                    View in Shopify
                  </Button>
                </a>
              </BlockStack>
            </Card>

            <div style={{ marginTop: '16px' }} />

            {/* Product Notes Card */}
            {productId && (
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
                  <Text variant="bodySm" as="p" tone="subdued">
                    Auto-saves on blur. Included in AI description generation.
                  </Text>
                </BlockStack>
              </Card>
            )}

            <div style={{ marginTop: '16px' }} />

            {/* Pipeline Status Card */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Pipeline Status</Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: draft.draft_description ? '#22c55e' : '#d1d5db' }} />
                    <Text variant="bodySm" as="span">
                      Description {draft.draft_description ? 'generated' : 'not generated'}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: draftImages.length > 0 ? '#22c55e' : '#d1d5db' }} />
                    <Text variant="bodySm" as="span">
                      Photos {draftImages.length > 0 ? `processed (${draftImages.length})` : 'not processed'}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: draft.status === 'approved' ? '#22c55e' : draft.status === 'rejected' ? '#ef4444' : '#f59e0b' }} />
                    <Text variant="bodySm" as="span">
                      Review: {draft.status}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <div style={{ height: '2rem' }} />
      </Page>

      {/* Photo Editor Modal */}
      {editingPhotoIndex !== null && (
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
          productId={draft?.shopify_product_id}
        />
      )}
    </>
  );
};

export default ReviewDetail;
