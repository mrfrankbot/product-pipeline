import React, { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  FormLayout,
  Icon,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  StarIcon,
  StarFilledIcon,
  ChartLineIcon,
  PlusIcon,
} from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';

interface FeatureRequest {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  requested_by: string | null;
  completed_at: string | null;
  admin_notes: string | null;
  votes?: number;
  created_at: string;
  updated_at: string;
}

const statusBadge = (status: string) => {
  switch (status) {
    case 'new':
      return <Badge tone="info">New</Badge>;
    case 'planned':
      return <Badge tone="attention">Planned</Badge>;
    case 'in_progress':
      return <Badge tone="warning">In Progress</Badge>;
    case 'completed':
      return <Badge tone="success">Completed</Badge>;
    case 'declined':
      return <Badge>Declined</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

const priorityBadge = (priority: string) => {
  switch (priority) {
    case 'critical':
      return <Badge tone="critical">Critical</Badge>;
    case 'high':
      return <Badge tone="warning">High</Badge>;
    case 'medium':
      return <Badge tone="info">Medium</Badge>;
    case 'low':
      return <Badge>Low</Badge>;
    default:
      return <Badge>{priority}</Badge>;
  }
};

const FeatureRequests: React.FC = () => {
  const queryClient = useQueryClient();

  const voterId = useMemo(() => {
    if (typeof window === 'undefined') return 'anonymous';
    const existing = localStorage.getItem('pp-feature-voter-id');
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `pp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('pp-feature-voter-id', generated);
    return generated;
  }, []);

  const [votedIds, setVotedIds] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('pp-feature-votes');
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as number[]);
    } catch {
      return new Set();
    }
  });

  const [submitOpen, setSubmitOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newRequestedBy, setNewRequestedBy] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['features', filterStatus],
    queryFn: () => {
      const params = filterStatus === 'all' ? '' : `?status=${filterStatus}`;
      return apiClient.get<{ data: FeatureRequest[]; total: number }>(`/features${params}`);
    },
  });

  const submitRequest = useMutation({
    mutationFn: (body: {
      title: string;
      description: string;
      requested_by?: string;
      priority?: string;
    }) => apiClient.post('/features', body),
    onSuccess: () => {
      setSubmitOpen(false);
      setNewTitle('');
      setNewDescription('');
      setNewPriority('medium');
      setNewRequestedBy('');
      queryClient.invalidateQueries({ queryKey: ['features'] });
    },
  });

  const voteForFeature = useMutation({
    mutationFn: (featureId: number) =>
      apiClient.post(`/features/${featureId}/vote`, { voterId }),
    onSuccess: (_data, featureId) => {
      setVotedIds((prev) => {
        const next = new Set(prev);
        next.add(featureId);
        if (typeof window !== 'undefined') {
          localStorage.setItem('pp-feature-votes', JSON.stringify(Array.from(next)));
        }
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['features'] });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!newTitle.trim() || !newDescription.trim()) return;
    submitRequest.mutate({
      title: newTitle.trim(),
      description: newDescription.trim(),
      priority: newPriority,
      ...(newRequestedBy.trim() ? { requested_by: newRequestedBy.trim() } : {}),
    });
  }, [newTitle, newDescription, newPriority, newRequestedBy, submitRequest]);

  const statusOptions = [
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Planned', value: 'planned' },
    { label: 'In Progress', value: 'in_progress' },
    { label: 'Completed', value: 'completed' },
    { label: 'Declined', value: 'declined' },
  ];

  const features = data?.data || [];

  if (error) {
    return (
      <Page title="Feature Requests">
        <Banner tone="critical" title="Failed to load feature requests">
          <Text as="p">{(error as Error).message}</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Feature Requests"
      subtitle="Suggest improvements and track what's coming"
      primaryAction={{
        content: 'Submit Request',
        icon: PlusIcon,
        onAction: () => setSubmitOpen(true),
      }}
    >
      <Layout>
        {/* Header stats + filter */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center" wrap>
              <InlineStack gap="300" blockAlign="center">
                <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                  <Icon source={StarIcon} />
                </Box>
                <BlockStack gap="050">
                  <Text variant="headingSm" as="h2">Feature requests</Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    {features.length} request{features.length !== 1 ? 's' : ''}
                    {filterStatus !== 'all' ? ` with status "${filterStatus}"` : ''}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Box minWidth="200px">
                <Select
                  label="Filter by status"
                  labelHidden
                  options={statusOptions}
                  value={filterStatus}
                  onChange={setFilterStatus}
                />
              </Box>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Feature list */}
        <Layout.Section>
          {isLoading ? (
            <Card>
              <SkeletonBodyText lines={8} />
            </Card>
          ) : features.length === 0 ? (
            <Card>
              <EmptyState heading="No feature requests" image="">
                <Text as="p">
                  {filterStatus !== 'all'
                    ? 'No requests with this status. Try a different filter.'
                    : 'No feature requests yet. Be the first to submit one!'}
                </Text>
                <Button onClick={() => setSubmitOpen(true)} variant="primary">
                  Submit first request
                </Button>
              </EmptyState>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="0">
                {features.map((feature, index) => (
                  <React.Fragment key={feature.id}>
                    {index > 0 && <Divider />}
                    <Box padding="400">
                      <BlockStack gap="300">
                        {/* Title + badges */}
                        <InlineStack align="space-between" blockAlign="start" wrap>
                          <BlockStack gap="100">
                            <Text variant="headingSm" as="h3">
                              {feature.title}
                            </Text>
                            <InlineStack gap="200">
                              {statusBadge(feature.status)}
                              {priorityBadge(feature.priority)}
                            </InlineStack>
                          </BlockStack>

                          {/* Votes + date */}
                          <BlockStack gap="100" inlineAlign="end">
                            <Text variant="bodySm" tone="subdued" as="span">
                              {new Date(feature.created_at).toLocaleDateString()}
                            </Text>
                            <InlineStack gap="200" blockAlign="center">
                              <InlineStack gap="100" blockAlign="center">
                                <Icon
                                  source={votedIds.has(feature.id) ? StarFilledIcon : StarIcon}
                                  tone={votedIds.has(feature.id) ? 'warning' : 'subdued'}
                                />
                                <Text variant="bodySm" fontWeight="semibold" as="span">
                                  {feature.votes ?? 0}
                                </Text>
                              </InlineStack>
                              <Button
                                size="slim"
                                variant={votedIds.has(feature.id) ? 'secondary' : 'primary'}
                                disabled={votedIds.has(feature.id)}
                                onClick={() => voteForFeature.mutate(feature.id)}
                              >
                                {votedIds.has(feature.id) ? 'Voted' : 'Vote'}
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>

                        {/* Description */}
                        <Text variant="bodyMd" tone="subdued" as="p">
                          {feature.description}
                        </Text>

                        {/* Admin notes */}
                        {feature.admin_notes && (
                          <Box
                            background="bg-fill-secondary"
                            borderRadius="200"
                            paddingInlineStart="300"
                            paddingBlockStart="200"
                            paddingBlockEnd="200"
                            paddingInlineEnd="300"
                          >
                            <BlockStack gap="050">
                              <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">
                                Admin notes
                              </Text>
                              <Text variant="bodySm" as="p">
                                {feature.admin_notes}
                              </Text>
                            </BlockStack>
                          </Box>
                        )}

                        {/* Footer */}
                        <InlineStack gap="300">
                          {feature.requested_by && (
                            <Text variant="bodySm" tone="subdued" as="span">
                              Requested by {feature.requested_by}
                            </Text>
                          )}
                          {feature.completed_at && (
                            <Text variant="bodySm" tone="subdued" as="span">
                              · Completed {new Date(feature.completed_at).toLocaleDateString()}
                            </Text>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  </React.Fragment>
                ))}
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      {/* Submit modal */}
      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Submit Feature Request"
        primaryAction={{
          content: 'Submit',
          onAction: handleSubmit,
          loading: submitRequest.isPending,
          disabled: !newTitle.trim() || !newDescription.trim(),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setSubmitOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Title"
              value={newTitle}
              onChange={setNewTitle}
              placeholder="Brief title for your request"
              autoComplete="off"
              requiredIndicator
            />
            <TextField
              label="Description"
              value={newDescription}
              onChange={setNewDescription}
              multiline={4}
              placeholder="Describe the feature and why it would be useful…"
              autoComplete="off"
              requiredIndicator
            />
            <Select
              label="Priority"
              options={[
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
                { label: 'Critical', value: 'critical' },
              ]}
              value={newPriority}
              onChange={setNewPriority}
            />
            <TextField
              label="Your name (optional)"
              value={newRequestedBy}
              onChange={setNewRequestedBy}
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
};

export default FeatureRequests;
