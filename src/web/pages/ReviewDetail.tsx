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
  Pagination,
  Banner,
  Modal,
  InlineGrid,
  Thumbnail,
} from '@shopify/polaris';
import {
  ExternalIcon,
  EditIcon,
  ViewIcon,
  CheckIcon,
  XIcon,
  ArrowLeftIcon,
} from '@shopify/polaris-icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, useProductNotes, useSaveProductNotes } from '../hooks/useApi';
import { useAppStore } from '../store';
import ProductPhotoEditor from '../components/ProductPhotoEditor';
import DraggablePhotoGrid from '../components/DraggablePhotoGrid';

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

  const [localNotes, setLocalNotes] = useState('');
  const [notesInit, setNotesInit] = useState(false);

  const [editingPhotoIndex, setEditingPhotoIndex] = useState<number | null>(null);

  const [ebayListingResult] = useState<{ listingId: string; ebayUrl: string } | null>(null);

  const { data: queueData } = useQuery({
    queryKey: ['drafts', 'pending', 'nav'],
    queryFn: () => apiClient.get<DraftListResponse>('/drafts?status=pending&limit=200&offset=0'),
    staleTime: 30000,
  });

  const queueIds = useMemo(() => queueData?.data?.map((d) => d.id) || [], [queueData]);
  const currentIndex = useMemo(() => queueIds.indexOf(draftId), [queueIds, draftId]);
  const prevId = currentIndex > 0 ? queueIds[currentIndex - 1] : null;
  const nextId = currentIndex >= 0 && currentIndex < queueIds.length - 1 ? queueIds[currentIndex + 1] : null;

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

  useEffect(() => {
    if (notesData?.notes !== undefined && !notesInit) {
      setLocalNotes(notesData.notes);
      setNotesInit(true);
    }
  }, [notesData, notesInit]);

  useEffect(() => {
    setNotesInit(false);
    setLocalNotes('');
    setIsEditing(false);
  }, [draftId]);

  const approveMutation = useMutation({
    mutationFn: ({ photos, description }: { photos: boolean; description: boolean }) =>
      apiClient.post(`/drafts/${draftId}/approve`, { photos, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      queryClient.invalidateQueries({ queryKey: ['draft-detail'] });
      addNotification({ type: 'success', title: 'Draft approved', message: 'Changes pushed to Shopify', autoClose: 4000 });
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

  const reorderMutation = useMutation({
    mutationFn: (newImages: string[]) =>
      apiClient.put(`/drafts/${draftId}`, { images: newImages }),
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

  const handleReorderPhotos = useCallback(
    async (newImages: string[]): Promise<void> => {
      await reorderMutation.mutateAsync(newImages);
    },
    [reorderMutation],
  );

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditing) return;
      if (e.key === 'ArrowLeft' && prevId) navigate(`/review/${prevId}`);
      if (e.key === 'ArrowRight' && nextId) navigate(`/review/${nextId}`);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevId, nextId, navigate, isEditing]);

  if (isLoading || !draft || !live) {
    return (
      <Page
        backAction={{ content: 'Review Queue', url: '/review' }}
        title="Loading..."
      >
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

  const draftImages = (draft.draftImages || []).filter((img) => img && img.startsWith('http'));
  const liveImages = (live.images || []).filter((img) => img && img.startsWith('http'));

  const listingId = ebayListingResult?.listingId || draft.ebay_listing_id;

  return (
    <>
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
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Photos
                  </Text>
                  <Badge>{`${draftImages.length} draft${liveImages.length > 0 ? ` · ${liveImages.length} live` : ''}`}</Badge>
                </InlineStack>

                {draftImages.length === 0 && liveImages.length === 0 ? (
                  <Banner tone="info">
                    <Text as="p">No photos available for this draft.</Text>
                  </Banner>
                ) : draftImages.length > 0 && liveImages.length > 0 ? (
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3" tone="subdued">
                      Draft Photos (New)
                    </Text>
                    <DraggablePhotoGrid
                      imageUrls={draftImages}
                      onChange={handleReorderPhotos}
                      onEditPhoto={(i) => setEditingPhotoIndex(i)}
                      enableBulkEdit
                      draftId={draftId}
                    />
                    <Divider />
                    <Text variant="headingSm" as="h3" tone="subdued">
                      Current Live Photos
                    </Text>
                    <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="200">
                      {liveImages.map((img, i) => (
                        <Card key={`live-${i}`} padding="200">
                          <BlockStack gap="200" inlineAlign="center">
                            <Thumbnail source={img} alt={`Live photo ${i + 1}`} size="large" />
                            <Button variant="plain" icon={ViewIcon} onClick={() => setLightboxSrc(img)}>
                              View
                            </Button>
                          </BlockStack>
                        </Card>
                      ))}
                    </InlineGrid>
                  </BlockStack>
                ) : draftImages.length > 0 ? (
                  <DraggablePhotoGrid
                    imageUrls={draftImages}
                    onChange={handleReorderPhotos}
                    onEditPhoto={(i) => setEditingPhotoIndex(i)}
                    enableBulkEdit
                    draftId={draftId}
                  />
                ) : (
                  <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="200">
                    {liveImages.map((img, i) => (
                      <Card key={i} padding="200">
                        <BlockStack gap="200" inlineAlign="center">
                          <Thumbnail source={img} alt={`Live photo ${i + 1}`} size="large" />
                          <Button variant="plain" icon={ViewIcon} onClick={() => setLightboxSrc(img)}>
                            View
                          </Button>
                        </BlockStack>
                      </Card>
                    ))}
                  </InlineGrid>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    AI Description
                  </Text>
                  {draft.status === 'pending' && !isEditing && (
                    <Button icon={EditIcon} onClick={handleStartEdit} size="slim">
                      Edit
                    </Button>
                  )}
                </InlineStack>

                {isEditing ? (
                  <BlockStack gap="300">
                    <TextField
                      label=""
                      labelHidden
                      value={editDescription}
                      onChange={setEditDescription}
                      multiline={12}
                      autoComplete="off"
                    />
                    <InlineStack gap="200">
                      <Button variant="primary" onClick={handleSaveEdit} loading={updateMutation.isPending}>
                        Save Changes
                      </Button>
                      <Button onClick={() => setIsEditing(false)}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <Card background="bg-surface-secondary" padding="300">
                    <Box>
                      <div dangerouslySetInnerHTML={{ __html: draft.draft_description || '<em>No description</em>' }} />
                    </Box>
                  </Card>
                )}

                {live.description && (
                  <>
                    <Divider />
                    <Text variant="headingSm" as="h3" tone="subdued">
                      Current Live Description
                    </Text>
                    <Card background="bg-surface-secondary" padding="300">
                      <Box>
                        <div dangerouslySetInnerHTML={{ __html: live.description }} />
                      </Box>
                    </Card>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            {draft.status === 'pending' && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Actions
                  </Text>
                  <Button
                    variant="primary"
                    tone="success"
                    size="large"
                    fullWidth
                    onClick={() => approveMutation.mutate({ photos: true, description: true })}
                    loading={approveMutation.isPending}
                  >
                    Approve all
                  </Button>
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
                    <Button fullWidth size="slim" onClick={() => approveMutation.mutate({ photos: true, description: false })}>
                      Photos only
                    </Button>
                    <Button fullWidth size="slim" onClick={() => approveMutation.mutate({ photos: false, description: true })}>
                      Description only
                    </Button>
                  </InlineGrid>
                  <Divider />
                  <Button variant="primary" size="large" fullWidth url={`/review/${draftId}/ebay-prep`}>
                    Approve &amp; List on eBay
                  </Button>
                  <Divider />
                  <Button fullWidth onClick={handleSkip} icon={ArrowLeftIcon}>
                    Skip
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
                  <Text variant="headingMd" as="h2">
                    Status
                  </Text>
                  {statusBadge(draft.status)}
                  {draft.reviewed_at && (
                    <Text variant="bodySm" as="p" tone="subdued">
                      Reviewed {formatDate(draft.reviewed_at)}
                    </Text>
                  )}
                </BlockStack>
              </Card>
            )}

            {listingId && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      eBay Listing
                    </Text>
                    <Badge tone="success">Live</Badge>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="success">{`Listing #${listingId}`}</Badge>
                  </InlineStack>
                  <Button
                    fullWidth
                    icon={ExternalIcon}
                    size="slim"
                    url={ebayListingResult?.ebayUrl || `https://www.ebay.com/itm/${listingId}`}
                    target="_blank"
                  >
                    View on eBay
                  </Button>
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Product Info
                </Text>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span" tone="subdued">
                      Shopify ID
                    </Text>
                    <Text variant="bodySm" as="span">
                      {draft.shopify_product_id}
                    </Text>
                  </InlineStack>
                  {draft.draft_title && (
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">
                        Title
                      </Text>
                      <Text variant="bodySm" as="span">
                        {draft.draft_title}
                      </Text>
                    </InlineStack>
                  )}
                </BlockStack>
                <Button fullWidth icon={ExternalIcon} size="slim" url={shopifyAdminUrl} target="_blank">
                  View in Shopify
                </Button>
              </BlockStack>
            </Card>

            {productId && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      Notes
                    </Text>
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

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Pipeline Status
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={draft.draft_description ? 'success' : 'critical'}>
                      {draft.draft_description ? 'Description generated' : 'Description missing'}
                    </Badge>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={draftImages.length > 0 ? 'success' : 'critical'}>
                      {draftImages.length > 0 ? `Photos processed (${draftImages.length})` : 'Photos not processed'}
                    </Badge>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={draft.status === 'approved' || draft.status === 'listed' ? 'success' : draft.status === 'rejected' ? 'critical' : 'warning'}>
                      {`Review: ${draft.status}`}
                    </Badge>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={listingId ? 'success' : 'warning'}>
                      {listingId ? `eBay listed (#${listingId})` : 'eBay not listed'}
                    </Badge>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      <Modal
        open={Boolean(lightboxSrc)}
        onClose={() => setLightboxSrc(null)}
        title="Photo preview"
        primaryAction={{
          content: 'Close',
          onAction: () => setLightboxSrc(null),
        }}
      >
        <Modal.Section>
          <InlineStack align="center">
            {lightboxSrc ? <Thumbnail source={lightboxSrc} alt="Enlarged photo" size="large" /> : null}
          </InlineStack>
        </Modal.Section>
      </Modal>

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
