import React, { useState } from 'react';
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Badge,
  Button,
  ButtonGroup,
  Thumbnail,
  Text,
  Filters,
  ChoiceList,
  Modal,
  Banner,
  BlockStack,
  InlineStack,
  Spinner,
  EmptyState,
  Tabs,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../hooks/useApi';
import AutoPublishSettings from '../components/AutoPublishSettings';

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

// ── Helpers ────────────────────────────────────────────────────────────

const statusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge tone="attention">Pending</Badge>;
    case 'approved':
      return <Badge tone="success">Approved</Badge>;
    case 'rejected':
      return <Badge tone="critical">Rejected</Badge>;
    case 'partial':
      return <Badge tone="warning">Partial</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

const formatDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const truncateHtml = (html: string, maxLen = 120) => {
  const text = html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ');
  return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
};

// ── Main Component ─────────────────────────────────────────────────────

const ReviewQueue: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string[]>(['pending']);
  const [page, setPage] = useState(0);
  const [bulkApproveModalOpen, setBulkApproveModalOpen] = useState(false);
  const limit = 20;

  const tabs = [
    { id: 'queue', content: 'Review Queue' },
    { id: 'settings', content: 'Auto-Publish Settings' },
  ];

  const statusValue = statusFilter[0] || 'pending';

  // ── Queries ────────────────────────────────────────────────────────

  const { data: draftsData, isLoading } = useQuery({
    queryKey: ['drafts', statusValue, page],
    queryFn: () =>
      apiClient.get<DraftListResponse>(
        `/drafts?status=${statusValue}&limit=${limit}&offset=${page * limit}`,
      ),
    refetchInterval: 10000,
  });

  const { data: draftCount } = useQuery({
    queryKey: ['drafts-count'],
    queryFn: () => apiClient.get<{ count: number }>('/drafts/count'),
    refetchInterval: 10000,
  });

  // ── Mutations ──────────────────────────────────────────────────────

  const bulkApproveMutation = useMutation({
    mutationFn: () => apiClient.post('/drafts/approve-all', { photos: true, description: true, confirm: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['drafts-count'] });
      setBulkApproveModalOpen(false);
    },
  });

  // ── Main Render ────────────────────────────────────────────────────

  const drafts = draftsData?.data || [];
  const total = draftsData?.total || 0;
  const pendingCount = draftCount?.count || 0;

  return (
    <Page
      title="Review Queue"
      subtitle={`${pendingCount} drafts awaiting review`}
      primaryAction={
        pendingCount > 0
          ? {
              content: `Approve All (${pendingCount})`,
              onAction: () => setBulkApproveModalOpen(true),
            }
          : undefined
      }
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        {selectedTab === 0 ? (
          <Layout>
            <Layout.Section>
              <Card padding="0">
                <div style={{ padding: '16px 16px 0' }}>
                  <Filters
                    queryValue=""
                    onQueryChange={() => {}}
                    onQueryClear={() => {}}
                    onClearAll={() => setStatusFilter(['pending'])}
                    filters={[
                      {
                        key: 'status',
                        label: 'Status',
                        filter: (
                          <ChoiceList
                            title="Status"
                            titleHidden
                            choices={[
                              { label: 'Pending', value: 'pending' },
                              { label: 'Approved', value: 'approved' },
                              { label: 'Rejected', value: 'rejected' },
                              { label: 'Partial', value: 'partial' },
                              { label: 'All', value: 'all' },
                            ]}
                            selected={statusFilter}
                            onChange={(value) => {
                              setStatusFilter(value);
                              setPage(0);
                            }}
                          />
                        ),
                        shortcut: true,
                      },
                    ]}
                    appliedFilters={
                      statusFilter[0] !== 'pending'
                        ? [
                            {
                              key: 'status',
                              label: `Status: ${statusFilter[0]}`,
                              onRemove: () => setStatusFilter(['pending']),
                            },
                          ]
                        : []
                    }
                    hideQueryField
                  />
                </div>

                {isLoading ? (
                  <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <Spinner size="large" />
                  </div>
                ) : drafts.length === 0 ? (
                  <EmptyState heading="No drafts found" image="">
                    <p>
                      {statusValue === 'pending'
                        ? 'All caught up! No drafts awaiting review.'
                        : `No ${statusValue} drafts.`}
                    </p>
                  </EmptyState>
                ) : (
                  <ResourceList
                    resourceName={{ singular: 'draft', plural: 'drafts' }}
                    items={drafts}
                    renderItem={(draft: Draft) => {
                      const thumbnail = draft.draftImages?.[0];
                      const media =
                        thumbnail && thumbnail.startsWith('http') ? (
                          <Thumbnail source={thumbnail} alt={draft.draft_title || ''} size="medium" />
                        ) : (
                          <Thumbnail source="" alt="" size="medium" />
                        );

                      return (
                        <ResourceItem
                          id={String(draft.id)}
                          media={media}
                          onClick={() => navigate(`/review/${draft.id}`)}
                          accessibilityLabel={`Review draft ${draft.draft_title || draft.shopify_product_id}`}
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text variant="bodyMd" fontWeight="bold" as="span">
                                {draft.draft_title || draft.original_title || `Product #${draft.shopify_product_id}`}
                              </Text>
                              <Text variant="bodySm" as="span" tone="subdued">
                                {draft.draftImages.length} photos
                                {draft.draft_description
                                  ? ` · ${truncateHtml(draft.draft_description, 80)}`
                                  : ''}
                              </Text>
                              <Text variant="bodySm" as="span" tone="subdued">
                                {formatDate(draft.created_at)}
                              </Text>
                            </BlockStack>
                            {statusBadge(draft.status)}
                          </InlineStack>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </Card>

              {/* Pagination */}
              {total > limit && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem', gap: '0.5rem' }}>
                  <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Text variant="bodySm" as="span" tone="subdued">
                    Page {page + 1} of {Math.ceil(total / limit)}
                  </Text>
                  <Button disabled={(page + 1) * limit >= total} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </Layout.Section>
          </Layout>
        ) : (
          <Layout>
            <Layout.Section>
              <AutoPublishSettings />
            </Layout.Section>
          </Layout>
        )}
      </Tabs>

      {/* Bulk Approve Modal */}
      <Modal
        open={bulkApproveModalOpen}
        onClose={() => setBulkApproveModalOpen(false)}
        title="Bulk Approve All Pending Drafts"
        primaryAction={{
          content: `Approve All ${pendingCount} Drafts`,
          onAction: () => bulkApproveMutation.mutate(),
          loading: bulkApproveMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setBulkApproveModalOpen(false) }]}
      >
        <Modal.Section>
          <Banner tone="warning">
            <p>
              This will approve <strong>{pendingCount}</strong> pending drafts and push their content
              to Shopify. This action cannot be undone.
            </p>
          </Banner>
        </Modal.Section>
      </Modal>
    </Page>
  );
};

export default ReviewQueue;
