import React, { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  FormLayout,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
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
      const parsed = JSON.parse(raw) as number[];
      return new Set(parsed);
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
    mutationFn: (body: { title: string; description: string; requested_by?: string; priority?: string }) =>
      apiClient.post('/features', body),
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
    mutationFn: (featureId: number) => apiClient.post(`/features/${featureId}/vote`, { voterId }),
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

  const statusOptions = useMemo(
    () => [
      { label: 'All', value: 'all' },
      { label: 'New', value: 'new' },
      { label: 'Planned', value: 'planned' },
      { label: 'In Progress', value: 'in_progress' },
      { label: 'Completed', value: 'completed' },
      { label: 'Declined', value: 'declined' },
    ],
    [],
  );

  const features = data?.data || [];

  if (isLoading) {
    return (
      <Page title="Feature Requests">
        <Card>
          <Box padding="600">
            <InlineStack align="center">
              <Spinner size="large" accessibilityLabel="Loading feature requests" />
            </InlineStack>
          </Box>
        </Card>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Feature Requests">
        <Card>
          <BlockStack gap="200">
            <Text variant="headingMd" as="h2">
              Failed to load feature requests
            </Text>
            <Text as="p">{(error as Error).message}</Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Feature Requests"
      subtitle="Suggest improvements and track what's coming"
      primaryAction={{
        content: 'Submit Request',
        onAction: () => setSubmitOpen(true),
      }}
    >
      <Layout>
        {/* Filter */}
        <Layout.Section>
          <Card>
            <Box minWidth="200px" maxWidth="300px">
              <Select label="Filter by status" options={statusOptions} value={filterStatus} onChange={setFilterStatus} />
            </Box>
          </Card>
        </Layout.Section>

        {/* Feature list */}
        <Layout.Section>
          {features.length === 0 ? (
            <Card>
              <EmptyState heading="No feature requests" image="">
                <Text as="p">
                  {filterStatus !== 'all'
                    ? 'No requests with this status. Try a different filter.'
                    : 'No feature requests yet. Be the first to submit one!'}
                </Text>
              </EmptyState>
            </Card>
          ) : (
            <BlockStack gap="300">
              {features.map((feature) => (
                <Card key={feature.id}>
                  <BlockStack gap="200">
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
                      <BlockStack gap="100" inlineAlign="end">
                        <Text as="span" tone="subdued" variant="bodySm">
                          {new Date(feature.created_at).toLocaleDateString()}
                        </Text>
                        <InlineStack gap="100" blockAlign="center">
                          <Badge tone="info">{`${feature.votes ?? 0} votes`}</Badge>
                          <Button
                            size="slim"
                            disabled={votedIds.has(feature.id)}
                            onClick={() => voteForFeature.mutate(feature.id)}
                          >
                            {votedIds.has(feature.id) ? 'Voted' : 'Vote'}
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>

                    <Text as="p">{feature.description}</Text>

                    {feature.admin_notes && (
                      <Box
                        paddingInlineStart="300"
                        paddingBlockStart="200"
                        paddingBlockEnd="200"
                        borderInlineStartWidth="025"
                        borderColor="border"
                      >
                        <BlockStack gap="100">
                          <Text variant="bodySm" as="span" tone="subdued" fontWeight="semibold">
                            Admin notes:
                          </Text>
                          <Text as="p" variant="bodySm">
                            {feature.admin_notes}
                          </Text>
                        </BlockStack>
                      </Box>
                    )}

                    <InlineStack gap="200">
                      {feature.requested_by && (
                        <Text as="span" tone="subdued" variant="bodySm">
                          Requested by {feature.requested_by}
                        </Text>
                      )}
                      {feature.completed_at && (
                        <Text as="span" tone="subdued" variant="bodySm">
                          · Completed {new Date(feature.completed_at).toLocaleDateString()}
                        </Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
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
              placeholder="Describe the feature you'd like and why it would be useful..."
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
