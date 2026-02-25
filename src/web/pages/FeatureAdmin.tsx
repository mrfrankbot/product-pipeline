import React, { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  EmptyState,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
} from '@shopify/polaris';
import type { TabProps } from '@shopify/polaris';
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

const STATUS_TABS = ['all', 'new', 'planned', 'in_progress', 'completed', 'declined'] as const;

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

const FeatureAdmin: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Edit form state
  const [editStatus, setEditStatus] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const activeStatus = STATUS_TABS[selectedTab];

  const { data, isLoading, error } = useQuery({
    queryKey: ['features-admin', activeStatus],
    queryFn: () => {
      const params = activeStatus === 'all' ? '' : `?status=${activeStatus}`;
      return apiClient.get<{ data: FeatureRequest[]; total: number }>(`/features${params}`);
    },
  });

  const updateFeature = useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: string; priority?: string; admin_notes?: string }) =>
      apiClient.put(`/features/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features-admin'] });
      queryClient.invalidateQueries({ queryKey: ['features'] });
      setExpandedId(null);
    },
  });

  const deleteFeature = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/features/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features-admin'] });
      queryClient.invalidateQueries({ queryKey: ['features'] });
    },
  });

  const handleExpand = useCallback(
    (f: FeatureRequest) => {
      if (expandedId === f.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(f.id);
      setEditStatus(f.status);
      setEditPriority(f.priority || 'medium');
      setEditNotes(f.admin_notes || '');
    },
    [expandedId],
  );

  const handleSave = useCallback(
    (id: number) => {
      updateFeature.mutate({
        id,
        status: editStatus,
        priority: editPriority,
        admin_notes: editNotes || undefined,
      });
    },
    [editStatus, editPriority, editNotes, updateFeature],
  );

  const tabs: TabProps[] = STATUS_TABS.map((status) => ({
    id: status,
    content: status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1),
    accessibilityLabel: `${status} feature requests`,
    panelID: `${status}-panel`,
  }));

  const features = data?.data || [];

  if (isLoading) {
    return (
      <Page title="Feature Admin">
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
      <Page title="Feature Admin">
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
    <Page title="Feature Admin" subtitle="Manage feature requests — set status, priority, and notes">
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box paddingBlockStart="400">
                {features.length === 0 ? (
                  <EmptyState heading="No feature requests" image="">
                    <Text as="p">No {activeStatus === 'all' ? '' : activeStatus} feature requests found.</Text>
                  </EmptyState>
                ) : (
                  <BlockStack gap="300">
                    {features.map((f) => {
                      const isExpanded = expandedId === f.id;
                      return (
                        <Card key={f.id}>
                          <BlockStack gap="200">
                            <div
                              onClick={() => handleExpand(f)}
                              style={{ cursor: 'pointer' }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') handleExpand(f);
                              }}
                            >
                              <InlineStack align="space-between" blockAlign="center" wrap>
                                <InlineStack gap="200" blockAlign="center" wrap>
                                  <Text variant="headingSm" as="span">
                                    {isExpanded ? '▾' : '▸'} #{f.id}
                                  </Text>
                                  <Text as="span" variant="bodyMd">
                                    {f.title.length > 60 ? f.title.slice(0, 60) + '…' : f.title}
                                  </Text>
                                </InlineStack>
                                <InlineStack gap="200" blockAlign="center">
                                  <Badge tone="info">{`${f.votes ?? 0} votes`}</Badge>
                                  {priorityBadge(f.priority)}
                                  {statusBadge(f.status)}
                                </InlineStack>
                              </InlineStack>
                            </div>

                            <InlineStack gap="400">
                              <Text as="span" tone="subdued" variant="bodySm">
                                {f.requested_by ? `By ${f.requested_by}` : 'Anonymous'} ·{' '}
                                {new Date(f.created_at).toLocaleDateString()}
                              </Text>
                              <InlineStack gap="100">
                                <Button
                                  size="slim"
                                  tone="critical"
                                  onClick={() => {
                                    if (confirm(`Delete feature request #${f.id}?`)) {
                                      deleteFeature.mutate(f.id);
                                    }
                                  }}
                                >
                                  Delete
                                </Button>
                              </InlineStack>
                            </InlineStack>

                            <Collapsible open={isExpanded} id={`edit-feature-${f.id}`}>
                              <Box
                                paddingBlockStart="400"
                                paddingBlockEnd="200"
                                borderBlockStartWidth="025"
                                borderColor="border"
                              >
                                <FormLayout>
                                  <Text variant="headingSm" as="h3">
                                    Description
                                  </Text>
                                  <Text as="p">{f.description}</Text>

                                  <InlineStack gap="400" wrap>
                                    <Box minWidth="200px">
                                      <Select
                                        label="Status"
                                        options={[
                                          { label: 'New', value: 'new' },
                                          { label: 'Planned', value: 'planned' },
                                          { label: 'In Progress', value: 'in_progress' },
                                          { label: 'Completed', value: 'completed' },
                                          { label: 'Declined', value: 'declined' },
                                        ]}
                                        value={editStatus}
                                        onChange={setEditStatus}
                                      />
                                    </Box>
                                    <Box minWidth="200px">
                                      <Select
                                        label="Priority"
                                        options={[
                                          { label: 'Low', value: 'low' },
                                          { label: 'Medium', value: 'medium' },
                                          { label: 'High', value: 'high' },
                                          { label: 'Critical', value: 'critical' },
                                        ]}
                                        value={editPriority}
                                        onChange={setEditPriority}
                                      />
                                    </Box>
                                  </InlineStack>

                                  <TextField
                                    label="Admin Notes"
                                    value={editNotes}
                                    onChange={setEditNotes}
                                    multiline={3}
                                    placeholder="Internal notes about this request..."
                                    autoComplete="off"
                                  />

                                  <InlineStack gap="200">
                                    <Button
                                      variant="primary"
                                      onClick={() => handleSave(f.id)}
                                      loading={updateFeature.isPending}
                                    >
                                      Save
                                    </Button>
                                    <Button onClick={() => setExpandedId(null)}>Cancel</Button>
                                  </InlineStack>
                                </FormLayout>
                              </Box>
                            </Collapsible>
                          </BlockStack>
                        </Card>
                      );
                    })}
                  </BlockStack>
                )}
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default FeatureAdmin;
