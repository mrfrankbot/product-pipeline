import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Tabs,
  TextField,
  Button,
  ButtonGroup,
  Banner,
  Modal,
  DataTable,
  Badge,
  Text,
  Icon,
  Tooltip,
  SkeletonBodyText,
  EmptyState
} from '@shopify/polaris';
import {
  EditIcon,
  SaveIcon,
  XSmallIcon as CancelIcon,
  ImportIcon,
  ExportIcon,
  ConnectIcon
} from '@shopify/polaris-icons';
// Mock hook for now
const useApi = <T,>(url: string) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const refetch = () => {
    // Mock refetch
  };
  
  useEffect(() => {
    // Mock data based on URL
    if (url === '/api/mappings') {
      setData([
        {
          category: 'General',
          fields: [
            {
              shopify_field: 'title',
              ebay_field: 'Title',
              field_type: 'text',
              is_required: true,
              last_updated: new Date().toISOString()
            },
            {
              shopify_field: 'description',
              ebay_field: 'Description',
              field_type: 'text',
              is_required: true,
              last_updated: new Date().toISOString()
            }
          ]
        }
      ] as T);
    }
  }, [url]);
  
  return { data, loading, error, refetch };
};

interface MappingField {
  shopify_field: string;
  ebay_field: string;
  field_type: string;
  is_required: boolean;
  default_value?: string;
  last_updated: string;
}

interface CategoryMappings {
  category: string;
  fields: MappingField[];
}

const Mappings: React.FC = () => {
  const [selectedTab, setSelectedTab] = useState(0);
  const [categories, setCategories] = useState<CategoryMappings[]>([]);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const { data: mappingsData, loading, error, refetch } = useApi<CategoryMappings[]>('/api/mappings');

  useEffect(() => {
    if (mappingsData) {
      setCategories(mappingsData);
    }
  }, [mappingsData]);

  const currentCategory = categories[selectedTab];

  const tabs = categories.map((category, index) => ({
    id: `category-${index}`,
    content: (
      category.category
    ),
    accessibilityLabel: `${category.category} mappings`,
  }));

  const handleEditField = (fieldKey: string, currentValue: string) => {
    setEditingField(fieldKey);
    setEditValue(currentValue);
  };

  const handleSaveField = async (fieldName: string) => {
    if (!currentCategory) return;

    setSaveStatus('saving');
    try {
      const response = await fetch(`/api/mappings/${currentCategory.category}/${fieldName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ebay_field: editValue })
      });

      if (response.ok) {
        setSaveStatus('success');
        setEditingField(null);
        setEditValue('');
        refetch();
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        throw new Error('Save failed');
      }
    } catch (err) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/mappings/export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mappings-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      setExportModalOpen(false);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;

    try {
      const formData = new FormData();
      formData.append('file', importFile);
      
      const response = await fetch('/api/mappings/import', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        setImportModalOpen(false);
        setImportFile(null);
        refetch();
      }
    } catch (err) {
      console.error('Import failed:', err);
    }
  };

  const renderMappingRow = (field: MappingField, index: number) => {
    const fieldKey = `${currentCategory?.category}-${field.shopify_field}`;
    const isEditing = editingField === fieldKey;

    return [
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Text as="span" fontWeight="semibold">{field.shopify_field}</Text>
        {field.is_required && <Badge size="small" tone="critical">Required</Badge>}
      </div>,
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon source={ConnectIcon} tone="subdued" />
      </div>,
      isEditing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '200px' }}>
          <TextField
            label=""
            value={editValue}
            onChange={setEditValue}
            autoComplete="off"
            size="slim"
          />
          <ButtonGroup>
            <Tooltip content="Save">
              <Button
                icon={SaveIcon}
                variant="primary"
                size="micro"
                onClick={() => handleSaveField(field.shopify_field)}
                loading={saveStatus === 'saving'}
              />
            </Tooltip>
            <Tooltip content="Cancel">
              <Button
                icon={CancelIcon}
                size="micro"
                onClick={handleCancelEdit}
              />
            </Tooltip>
          </ButtonGroup>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Text as="span">{field.ebay_field || <Text tone="subdued">Not mapped</Text>}</Text>
          <Tooltip content="Edit mapping">
            <Button
              icon={EditIcon}
              variant="plain"
              size="micro"
              onClick={() => handleEditField(fieldKey, field.ebay_field || '')}
            />
          </Tooltip>
        </div>
      ),
      <Badge tone={field.field_type === 'text' ? 'info' : field.field_type === 'number' ? 'attention' : 'success'}>
        {field.field_type}
      </Badge>,
      <Text as="span" tone="subdued" variant="bodyXs">
        {new Date(field.last_updated).toLocaleDateString()}
      </Text>
    ];
  };

  if (loading) {
    return (
      <Page title="Field Mappings">
        <Card>
          <SkeletonBodyText lines={10} />
        </Card>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Field Mappings">
        <Banner tone="critical">
          <p>Failed to load mappings: {error.message}</p>
        </Banner>
      </Page>
    );
  }

  if (!categories.length) {
    return (
      <Page title="Field Mappings">
        <Card>
          <EmptyState
            heading="No mappings configured"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Configure field mappings between Shopify and eBay to start syncing products.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Field Mappings"
      subtitle="Configure how Shopify fields map to eBay fields"
      primaryAction={{
        content: 'Bulk Operations',
        onAction: () => setExportModalOpen(true)
      }}
    >
      {saveStatus === 'success' && (
        <Banner tone="success" onDismiss={() => setSaveStatus('idle')}>
          Mapping saved successfully
        </Banner>
      )}
      {saveStatus === 'error' && (
        <Banner tone="critical" onDismiss={() => setSaveStatus('idle')}>
          Failed to save mapping. Please try again.
        </Banner>
      )}

      <Card>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          <div style={{ padding: '16px 0' }}>
            <Stack distribution="equalSpacing" alignment="center">
              <Stack spacing="tight">
                <Text as="h3" variant="headingMd">
                  {currentCategory?.category} Category
                </Text>
                <Text tone="subdued">
                  {currentCategory?.fields.length} fields configured
                </Text>
              </Stack>
              <ButtonGroup>
                <Button
                  icon={ImportIcon}
                  onClick={() => setImportModalOpen(true)}
                >
                  Import
                </Button>
                <Button
                  icon={ExportIcon}
                  onClick={handleExport}
                >
                  Export
                </Button>
              </ButtonGroup>
            </Stack>
          </div>

          {currentCategory && (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text']}
              headings={['Shopify Field', '', 'eBay Field', 'Type', 'Last Updated']}
              rows={currentCategory.fields.map(renderMappingRow)}
              truncate
            />
          )}
        </Tabs>
      </Card>

      {/* Export Modal */}
      <Modal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Export Mappings"
        primaryAction={{
          content: 'Export All',
          onAction: handleExport
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setExportModalOpen(false)
        }]}
      >
        <Modal.Section>
          <Text as="p">
            This will export all field mappings to a JSON file that can be imported later or shared with other instances.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Mappings"
        primaryAction={{
          content: 'Import',
          onAction: handleImport,
          disabled: !importFile
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setImportModalOpen(false)
        }]}
      >
        <Modal.Section>
          <Stack vertical>
            <Text as="p">
              Select a mapping export file to import. This will overwrite existing mappings.
            </Text>
            <div>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
            </div>
            {importFile && (
              <Text tone="subdued">
                Selected: {importFile.name}
              </Text>
            )}
          </Stack>
        </Modal.Section>
      </Modal>
    </Page>
  );
};

export default Mappings;