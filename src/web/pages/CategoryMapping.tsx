import React, { useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  Text,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Settings, Wifi, WifiOff } from 'lucide-react';
import { apiClient } from '../hooks/useApi';
import { useAppStore } from '../store';

/* ── Types ────────────────────────────────────────────────────────────── */

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

/* ── Helper Components ──────────────────────────────────────────────── */

const TemplatePreview: React.FC<{ params: PhotoRoomParams }> = ({ params }) => {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        backgroundColor: params.background,
        borderRadius: 6,
        border: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Inner box representing the product (with padding) */}
      <div
        style={{
          width: `${Math.max(10, 40 - params.padding * 80)}px`,
          height: `${Math.max(10, 40 - params.padding * 80)}px`,
          backgroundColor: '#9ca3af',
          borderRadius: 3,
          boxShadow: params.shadow ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
        }}
      />
    </div>
  );
};

const CategoryRow: React.FC<{
  category: string;
  templates: PhotoTemplate[];
  defaultTemplate: PhotoTemplate | null;
  onChangeTemplate: (category: string) => void;
  onCreateTemplate: (category: string) => void;
}> = ({ category, templates, defaultTemplate, onChangeTemplate, onCreateTemplate }) => {
  return (
    <Card padding="400">
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="300" blockAlign="center">
          <Box minWidth="200px">
            <Text variant="headingSm" as="h3">
              {category}
            </Text>
          </Box>
          
          {defaultTemplate ? (
            <InlineStack gap="300" blockAlign="center">
              <TemplatePreview params={defaultTemplate.params} />
              <BlockStack gap="050">
                <Text variant="bodyMd" as="span">
                  {defaultTemplate.name}
                </Text>
                <Text variant="bodySm" tone="subdued" as="span">
                  BG: {defaultTemplate.params.background} • 
                  Padding: {Math.round(defaultTemplate.params.padding * 100)}% • 
                  Shadow: {defaultTemplate.params.shadow ? 'On' : 'Off'}
                </Text>
              </BlockStack>
            </InlineStack>
          ) : (
            <Text variant="bodyMd" tone="subdued" as="span">
              No template assigned
            </Text>
          )}
        </InlineStack>
        
        <InlineStack gap="200">
          {templates.length > 0 ? (
            <Button
              size="slim"
              onClick={() => onChangeTemplate(category)}
            >
              {defaultTemplate ? 'Change' : 'Assign'}
            </Button>
          ) : (
            <Button
              size="slim"
              variant="primary"
              onClick={() => onCreateTemplate(category)}
            >
              Create Template
            </Button>
          )}
        </InlineStack>
      </InlineStack>
    </Card>
  );
};

/* ── Main Component ──────────────────────────────────────────────────── */

const CategoryMapping: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Fetch categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery<CategoriesResponse>({
    queryKey: ['template-categories'],
    queryFn: () => apiClient.get('/templates/categories'),
  });

  // Fetch all templates
  const { data: templatesData, isLoading: templatesLoading } = useQuery<TemplatesResponse>({
    queryKey: ['templates'],
    queryFn: () => apiClient.get('/templates'),
  });

  // Set template as default mutation
  const setDefaultMutation = useMutation({
    mutationFn: ({ templateId, category }: { templateId: number; category: string }) =>
      apiClient.post(`/templates/${templateId}/set-default`, { category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setTemplateModalOpen(false);
      setSelectedCategory(null);
      setSelectedTemplateId('');
      addNotification({
        type: 'success',
        title: 'Template assigned successfully',
        autoClose: 4000,
      });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Failed to assign template',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });

  const categories = categoriesData?.categories || [];
  const templates = templatesData?.templates || [];
  const mounted = categoriesData?.mounted || false;

  // Group templates by category and find defaults
  const templatesByCategory = templates.reduce((acc, template) => {
    const category = template.category || 'uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {} as Record<string, PhotoTemplate[]>);

  const defaultTemplates = templates.reduce((acc, template) => {
    if (template.isDefault && template.category) {
      acc[template.category] = template;
    }
    return acc;
  }, {} as Record<string, PhotoTemplate>);

  // Separate assigned and unassigned categories
  const assignedCategories = categories.filter(cat => defaultTemplates[cat]);
  const unassignedCategories = categories.filter(cat => !defaultTemplates[cat]);

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
    
    setDefaultMutation.mutate({
      templateId: parseInt(selectedTemplateId, 10),
      category: selectedCategory,
    });
  };

  const templateSelectOptions = [
    { label: 'Select a template...', value: '' },
    ...templates.map(template => ({
      label: `${template.name} (${template.params.background}, ${Math.round(template.params.padding * 100)}% padding)`,
      value: String(template.id),
    })),
  ];

  return (
    <Page
      title="StyleShoots Category Mapping"
      subtitle="Map each StyleShoots preset folder to a photo template. When new photos arrive, the template is auto-applied."
      primaryAction={{
        content: 'Manage Templates',
        onAction: () => navigate('/images'),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                {mounted ? (
                  <>
                    <Wifi size={16} color="#00a047" />
                    <Text variant="bodyMd" tone="success" as="span">
                      StyleShoots drive connected
                    </Text>
                  </>
                ) : (
                  <>
                    <WifiOff size={16} color="#d72c0d" />
                    <Text variant="bodyMd" tone="critical" as="span">
                      StyleShoots drive disconnected
                    </Text>
                  </>
                )}
              </InlineStack>
              <Text variant="bodySm" tone="subdued" as="span">
                {categories.length} categories found
              </Text>
            </InlineStack>
          </Card>
        </Layout.Section>

        {assignedCategories.length > 0 && (
          <Layout.Section>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                Assigned Categories
              </Text>
              <BlockStack gap="200">
                {assignedCategories.map(category => (
                  <CategoryRow
                    key={category}
                    category={category}
                    templates={templatesByCategory[category] || []}
                    defaultTemplate={defaultTemplates[category]}
                    onChangeTemplate={handleChangeTemplate}
                    onCreateTemplate={handleCreateTemplate}
                  />
                ))}
              </BlockStack>
            </BlockStack>
          </Layout.Section>
        )}

        {unassignedCategories.length > 0 && (
          <Layout.Section>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Unassigned Categories
                </Text>
                <Badge tone="attention">
                  {`${unassignedCategories.length} need templates`}
                </Badge>
              </InlineStack>
              <BlockStack gap="200">
                {unassignedCategories.map(category => (
                  <CategoryRow
                    key={category}
                    category={category}
                    templates={templatesByCategory[category] || []}
                    defaultTemplate={null}
                    onChangeTemplate={handleChangeTemplate}
                    onCreateTemplate={handleCreateTemplate}
                  />
                ))}
              </BlockStack>
            </BlockStack>
          </Layout.Section>
        )}

        {categories.length === 0 && !categoriesLoading && (
          <Layout.Section>
            <Card padding="400">
              <BlockStack gap="200" align="center">
                <Settings size={48} color="#6b7280" />
                <Text variant="headingMd" as="h3" alignment="center">
                  No categories found
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p" alignment="center">
                  Connect the StyleShoots drive or create templates with categories to get started.
                </Text>
                <Button
                  variant="primary"
                  onClick={() => navigate('/images')}
                >
                  Manage Templates
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Template Selection Modal */}
      <Modal
        open={templateModalOpen}
        onClose={() => {
          setTemplateModalOpen(false);
          setSelectedCategory(null);
          setSelectedTemplateId('');
        }}
        title={selectedCategory ? `Assign template to "${selectedCategory}"` : 'Assign Template'}
        primaryAction={{
          content: 'Assign Template',
          onAction: handleAssignTemplate,
          disabled: !selectedTemplateId,
          loading: setDefaultMutation.isPending,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setTemplateModalOpen(false);
              setSelectedCategory(null);
              setSelectedTemplateId('');
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd" as="p">
              Select a photo template to use as the default for the "{selectedCategory}" category.
              When new photos arrive in this category, the selected template will be automatically applied.
            </Text>
            
            {templates.length > 0 ? (
              <Select
                label="Photo Template"
                options={templateSelectOptions}
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
              />
            ) : (
              <Card padding="300">
                <BlockStack gap="200" align="center">
                  <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                    No templates available. Create a template first.
                  </Text>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setTemplateModalOpen(false);
                      handleCreateTemplate(selectedCategory || '');
                    }}
                  >
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