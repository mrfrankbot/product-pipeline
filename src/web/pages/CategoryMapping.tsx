import React, { useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  Text,
} from '@shopify/polaris';
import {
  ImageIcon,
  StatusActiveIcon,
  AlertCircleIcon,
  SettingsIcon,
  CheckCircleIcon,
} from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../hooks/useApi';
import { useAppStore } from '../store';

/* ────────────────── Types ────────────────── */

interface PhotoRoomParams {
  background: string;
  padding: number;
  shadow: boolean;
}

interface PhotoTemplate {
  id: number;
  name: string;
  category: string | null;
  params: PhotoRoomParams;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CategoriesResponse {
  ok: boolean;
  categories: string[];
  mounted: boolean;
}

interface TemplatesResponse {
  ok: boolean;
  templates: PhotoTemplate[];
}

/* ────────────────── Category Row ────────────────── */

const CategoryRow: React.FC<{
  category: string;
  templates: PhotoTemplate[];
  defaultTemplate: PhotoTemplate | null;
  onChangeTemplate: (category: string) => void;
  onCreateTemplate: (category: string) => void;
}> = ({ category, templates, defaultTemplate, onChangeTemplate, onCreateTemplate }) => (
  <Card>
    <InlineStack align="space-between" blockAlign="center">
      <InlineStack gap="300" blockAlign="center">
        <Box background={defaultTemplate ? 'bg-fill-success-secondary' : 'bg-fill-secondary'} borderRadius="200" padding="200">
          <Icon source={defaultTemplate ? CheckCircleIcon : ImageIcon} tone={defaultTemplate ? 'success' : 'base'} />
        </Box>
        <BlockStack gap="050">
          <Text variant="headingSm" as="h3">{category}</Text>
          {defaultTemplate ? (
            <Text variant="bodySm" tone="subdued" as="p">
              {defaultTemplate.name} · BG: {defaultTemplate.params.background} · Padding: {Math.round(defaultTemplate.params.padding * 100)}% · Shadow: {defaultTemplate.params.shadow ? 'On' : 'Off'}
            </Text>
          ) : (
            <Text variant="bodySm" tone="subdued" as="p">No template assigned</Text>
          )}
        </BlockStack>
      </InlineStack>
      <InlineStack gap="200">
        {templates.length > 0 ? (
          <Button size="slim" onClick={() => onChangeTemplate(category)}>
            {defaultTemplate ? 'Change' : 'Assign'}
          </Button>
        ) : (
          <Button size="slim" variant="primary" onClick={() => onCreateTemplate(category)}>
            Create Template
          </Button>
        )}
      </InlineStack>
    </InlineStack>
  </Card>
);

/* ────────────────── Main Component ────────────────── */

const CategoryMapping: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  const { data: categoriesData, isLoading: categoriesLoading } = useQuery<CategoriesResponse>({
    queryKey: ['template-categories'],
    queryFn: () => apiClient.get('/templates/categories'),
  });

  const { data: templatesData } = useQuery<TemplatesResponse>({
    queryKey: ['templates'],
    queryFn: () => apiClient.get('/templates'),
  });

  const setDefaultMutation = useMutation({
    mutationFn: ({ templateId, category }: { templateId: number; category: string }) =>
      apiClient.post(`/templates/${templateId}/set-default`, { category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setTemplateModalOpen(false);
      setSelectedCategory(null);
      setSelectedTemplateId('');
      addNotification({ type: 'success', title: 'Template assigned successfully', autoClose: 4000 });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Failed to assign template', message: error instanceof Error ? error.message : 'Unknown error', autoClose: 8000 });
    },
  });

  const categories = categoriesData?.categories || [];
  const templates = templatesData?.templates || [];
  const mounted = categoriesData?.mounted || false;

  const templatesByCategory = templates.reduce((acc, template) => {
    const cat = template.category || 'uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(template);
    return acc;
  }, {} as Record<string, PhotoTemplate[]>);

  const defaultTemplates = templates.reduce((acc, template) => {
    if (template.isDefault && template.category) acc[template.category] = template;
    return acc;
  }, {} as Record<string, PhotoTemplate>);

  const assignedCategories = categories.filter((cat) => defaultTemplates[cat]);
  const unassignedCategories = categories.filter((cat) => !defaultTemplates[cat]);

  const handleChangeTemplate = (category: string) => {
    setSelectedCategory(category);
    setTemplateModalOpen(true);
    setSelectedTemplateId('');
  };

  const handleCreateTemplate = (category: string) => {
    navigate(`/images?category=${encodeURIComponent(category)}`);
  };

  const handleAssignTemplate = () => {
    if (!selectedCategory || !selectedTemplateId) return;
    setDefaultMutation.mutate({ templateId: parseInt(selectedTemplateId, 10), category: selectedCategory });
  };

  const templateSelectOptions = [
    { label: 'Select a template...', value: '' },
    ...templates.map((t) => ({
      label: `${t.name} (${t.params.background}, ${Math.round(t.params.padding * 100)}% padding)`,
      value: String(t.id),
    })),
  ];

  return (
    <Page
      title="Category Mapping"
      subtitle="Map StyleShoots preset folders to photo templates for automatic processing"
      primaryAction={{ content: 'Manage Templates', onAction: () => navigate('/images') }}
    >
      <BlockStack gap="500">
        {/* Connection status */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              <Box
                background={mounted ? 'bg-fill-success-secondary' : 'bg-fill-critical-secondary'}
                borderRadius="full"
                padding="200"
              >
                <Icon source={mounted ? StatusActiveIcon : AlertCircleIcon} tone={mounted ? 'success' : 'critical'} />
              </Box>
              <BlockStack gap="050">
                <Text variant="headingSm" as="h2">
                  {mounted ? 'StyleShoots drive connected' : 'StyleShoots drive disconnected'}
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {categories.length} categories found
                </Text>
              </BlockStack>
            </InlineStack>
            <InlineStack gap="200">
              {assignedCategories.length > 0 && (
                <Badge tone="success">{`${assignedCategories.length} assigned`}</Badge>
              )}
              {unassignedCategories.length > 0 && (
                <Badge tone="attention">{`${unassignedCategories.length} need templates`}</Badge>
              )}
            </InlineStack>
          </InlineStack>
        </Card>

        {/* Assigned categories */}
        {assignedCategories.length > 0 && (
          <Layout>
            <Layout.Section>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="headingMd" as="h2">Assigned Categories</Text>
                  <Badge tone="success">{String(assignedCategories.length)}</Badge>
                </InlineStack>
                <BlockStack gap="200">
                  {assignedCategories.map((cat) => (
                    <CategoryRow
                      key={cat}
                      category={cat}
                      templates={templatesByCategory[cat] || []}
                      defaultTemplate={defaultTemplates[cat]}
                      onChangeTemplate={handleChangeTemplate}
                      onCreateTemplate={handleCreateTemplate}
                    />
                  ))}
                </BlockStack>
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}

        {/* Unassigned categories */}
        {unassignedCategories.length > 0 && (
          <Layout>
            <Layout.Section>
              <BlockStack gap="300">
                <InlineStack gap="200" align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h2">Unassigned Categories</Text>
                    <Badge tone="attention">{`${unassignedCategories.length} need templates`}</Badge>
                  </InlineStack>
                </InlineStack>
                <BlockStack gap="200">
                  {unassignedCategories.map((cat) => (
                    <CategoryRow
                      key={cat}
                      category={cat}
                      templates={templatesByCategory[cat] || []}
                      defaultTemplate={null}
                      onChangeTemplate={handleChangeTemplate}
                      onCreateTemplate={handleCreateTemplate}
                    />
                  ))}
                </BlockStack>
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}

        {/* Empty state */}
        {categories.length === 0 && !categoriesLoading && (
          <Card>
            <BlockStack gap="300" inlineAlign="center">
              <Box background="bg-fill-secondary" borderRadius="200" padding="400">
                <Icon source={SettingsIcon} />
              </Box>
              <Text variant="headingMd" as="h3" alignment="center">No categories found</Text>
              <Text variant="bodyMd" tone="subdued" as="p" alignment="center">
                Connect the StyleShoots drive or create templates with categories to get started.
              </Text>
              <Button variant="primary" onClick={() => navigate('/images')}>Manage Templates</Button>
            </BlockStack>
          </Card>
        )}
      </BlockStack>

      {/* Template Selection Modal */}
      <Modal
        open={templateModalOpen}
        onClose={() => { setTemplateModalOpen(false); setSelectedCategory(null); setSelectedTemplateId(''); }}
        title={selectedCategory ? `Assign template to "${selectedCategory}"` : 'Assign Template'}
        primaryAction={{
          content: 'Assign Template',
          onAction: handleAssignTemplate,
          disabled: !selectedTemplateId,
          loading: setDefaultMutation.isPending,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => { setTemplateModalOpen(false); setSelectedCategory(null); setSelectedTemplateId(''); },
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd" as="p">
              Select a photo template to use as the default for the "{selectedCategory}" category.
              When new photos arrive, the selected template will be automatically applied.
            </Text>
            {templates.length > 0 ? (
              <Select label="Photo Template" options={templateSelectOptions} value={selectedTemplateId} onChange={setSelectedTemplateId} />
            ) : (
              <Card>
                <BlockStack gap="200" inlineAlign="center">
                  <Text variant="bodyMd" as="p" tone="subdued" alignment="center">No templates available. Create a template first.</Text>
                  <Button variant="primary" onClick={() => { setTemplateModalOpen(false); handleCreateTemplate(selectedCategory || ''); }}>
                    Create Template
                  </Button>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
};

export default CategoryMapping;
