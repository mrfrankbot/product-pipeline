import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  Banner,
  Button,
  ButtonGroup,
  Card,
  Collapsible,
  DataTable,
  Layout,
  Page,
  Select,
  Spinner,
  TextField,
  Toast,
  Text,
  Modal,
  TextContainer,
  ProgressBar,
  Badge,
  Icon,
  Tooltip,
  Divider,
  Form,
  FormLayout,
} from '@shopify/polaris';
import { 
  ArrowRightIcon, 
  ExportIcon, 
  ImportIcon, 
  EditIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  FileIcon,
} from '@shopify/polaris-icons';

type MappingType = 'edit_in_grid' | 'constant' | 'shopify_field' | 'formula';

type Mapping = {
  id: number;
  category: string;
  field_name: string;
  mapping_type: MappingType;
  source_value: string;
  target_value: string;
  variation_mapping: string | null;
  is_enabled: boolean;
  display_order: number;
};

type MappingsResponse = {
  sales: Mapping[];
  listing: Mapping[];
  payment: Mapping[];
  shipping: Mapping[];
};

type MappingPreview = {
  shopifyField: string;
  transform: string;
  ebayField: string;
  sampleValue: string;
};

const Mappings: React.FC = () => {
  const [mappings, setMappings] = useState<MappingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    sales: true,
    listing: false,
    payment: false,
    shipping: false,
  });

  // Enhanced features state
  const [previewMapping, setPreviewMapping] = useState<Mapping | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState('');
  const [importData, setImportData] = useState('');
  const [selectedMappings, setSelectedMappings] = useState<Set<string>>(new Set());
  const [showMappingFlow, setShowMappingFlow] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/mappings');
      if (!response.ok) {
        throw new Error('Failed to load mappings');
      }
      const data = (await response.json()) as MappingsResponse;
      setMappings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMappings();
  }, [loadMappings]);

  const humanizeFieldName = (fieldName: string): string => {
    return fieldName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const humanizeCategory = (category: string): string => {
    const categoryMap: Record<string, string> = {
      sales: 'Sales',
      listing: 'Listing',
      payment: 'Payment',
      shipping: 'Shipping',
    };
    return categoryMap[category] || category;
  };

  const mappingTypeOptions = [
    { label: 'Edit in Grid', value: 'edit_in_grid' },
    { label: 'Constant Value', value: 'constant' },
    { label: 'Shopify Field', value: 'shopify_field' },
    { label: 'Formula', value: 'formula' },
  ];

  const handleEditMapping = (mapping: Mapping) => {
    setEditingMapping({ ...mapping });
  };

  const handlePreviewMapping = (mapping: Mapping) => {
    setPreviewMapping(mapping);
  };

  const handleSaveMapping = async () => {
    if (!editingMapping) return;

    setSaving(true);
    setError(null);

    try {
      const payload = {
        mapping_type: editingMapping.mapping_type,
        source_value: editingMapping.source_value,
        target_value: editingMapping.target_value,
        variation_mapping: editingMapping.variation_mapping,
        is_enabled: editingMapping.is_enabled,
      };

      const response = await fetch(
        `/api/mappings/${editingMapping.category}/${editingMapping.field_name}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to save mapping');
      }

      const updatedMapping = (await response.json()) as Mapping;

      // Update the mapping in the state
      setMappings((prev) => {
        if (!prev) return prev;
        const category = editingMapping.category as keyof MappingsResponse;
        return {
          ...prev,
          [category]: prev[category].map((m) =>
            m.field_name === editingMapping.field_name ? updatedMapping : m
          ),
        };
      });

      setEditingMapping(null);
      setToastMessage('Mapping saved successfully');
      setShowToast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingMapping(null);
  };

  const toggleCategory = (category: string) => {
    setOpenCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleExportMappings = async () => {
    try {
      const response = await fetch('/api/mappings/export');
      if (!response.ok) {
        throw new Error('Failed to export mappings');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `mappings-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setToastMessage('Mappings exported successfully');
      setShowToast(true);
      setShowExportModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export mappings');
    }
  };

  const handleImportMappings = async () => {
    if (!importData.trim()) {
      setError('Please provide mapping data to import');
      return;
    }

    try {
      const response = await fetch('/api/mappings/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: importData,
      });

      if (!response.ok) {
        throw new Error('Failed to import mappings');
      }

      await loadMappings(); // Reload mappings
      setImportData('');
      setShowImportModal(false);
      setToastMessage('Mappings imported successfully');
      setShowToast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import mappings');
    }
  };

  const handleBulkUpdate = async () => {
    if (!bulkUpdateData.trim()) {
      setError('Please provide bulk update data');
      return;
    }

    try {
      const response = await fetch('/api/mappings/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bulkUpdateData,
      });

      if (!response.ok) {
        throw new Error('Failed to perform bulk update');
      }

      await loadMappings(); // Reload mappings
      setBulkUpdateData('');
      setShowBulkModal(false);
      setToastMessage('Bulk update completed successfully');
      setShowToast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to perform bulk update');
    }
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setImportData(content);
      };
      reader.readAsText(file);
    }
  };

  const generateMappingPreview = (mapping: Mapping): MappingPreview => {
    let shopifyField = '';
    let transform = '';
    let ebayField = mapping.field_name;
    let sampleValue = '';

    switch (mapping.mapping_type) {
      case 'shopify_field':
        shopifyField = mapping.source_value || 'product.title';
        transform = 'Direct mapping';
        sampleValue = 'Sample Product Title';
        break;
      case 'constant':
        shopifyField = '(constant)';
        transform = 'Constant value';
        sampleValue = mapping.target_value || 'Fixed Value';
        break;
      case 'formula':
        shopifyField = 'Multiple fields';
        transform = mapping.target_value || 'Custom formula';
        sampleValue = 'Calculated Result';
        break;
      case 'edit_in_grid':
        shopifyField = '(manual)';
        transform = 'Manual entry';
        sampleValue = 'User-entered value';
        break;
    }

    return { shopifyField, transform, ebayField, sampleValue };
  };

  const renderMappingValue = (mapping: Mapping): string => {
    switch (mapping.mapping_type) {
      case 'constant':
        return mapping.target_value || '(empty)';
      case 'shopify_field':
        return mapping.source_value || '(not set)';
      case 'formula':
        return mapping.target_value || '(no formula)';
      case 'edit_in_grid':
        return 'Edit in grid';
      default:
        return '(unknown)';
    }
  };

  const renderMappingFlowDiagram = (mapping: Mapping) => {
    const preview = generateMappingPreview(mapping);
    
    return (
      <div style={{ 
        padding: '16px', 
        border: '1px solid #e1e1e1', 
        borderRadius: '8px', 
        backgroundColor: '#fafafa',
        margin: '16px 0'
      }}>
        <Text variant="headingSm" as="h4" tone="subdued">
          Mapping Flow Preview
        </Text>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px', 
          marginTop: '12px',
          flexWrap: 'wrap'
        }}>
          <div style={{ 
            padding: '8px 12px', 
            backgroundColor: '#e7f5f0', 
            borderRadius: '6px',
            minWidth: '120px',
            textAlign: 'center'
          }}>
            <Text as="span" variant="bodySm" tone="subdued">Shopify Field</Text>
            <div style={{ fontWeight: 'bold', marginTop: '4px' }}>
              {preview.shopifyField}
            </div>
          </div>
          
          <div style={{ color: '#666' }}>
            <Icon source={ArrowRightIcon} />
          </div>
          
          <div style={{ 
            padding: '8px 12px', 
            backgroundColor: '#fff2e5', 
            borderRadius: '6px',
            minWidth: '120px',
            textAlign: 'center'
          }}>
            <Text as="span" variant="bodySm" tone="subdued">Transform</Text>
            <div style={{ fontWeight: 'bold', marginTop: '4px', fontSize: '12px' }}>
              {preview.transform}
            </div>
          </div>
          
          <div style={{ color: '#666' }}>
            <Icon source={ArrowRightIcon} />
          </div>
          
          <div style={{ 
            padding: '8px 12px', 
            backgroundColor: '#e8f4fd', 
            borderRadius: '6px',
            minWidth: '120px',
            textAlign: 'center'
          }}>
            <Text as="span" variant="bodySm" tone="subdued">eBay Field</Text>
            <div style={{ fontWeight: 'bold', marginTop: '4px' }}>
              {humanizeFieldName(preview.ebayField)}
            </div>
          </div>
        </div>
        
        <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
          <Text as="span" variant="bodySm" tone="subdued">Sample Output: </Text>
          <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
            {preview.sampleValue}
          </span>
        </div>
      </div>
    );
  };

  const renderCategorySection = (category: keyof MappingsResponse, categoryMappings: Mapping[]) => {
    const isOpen = openCategories[category];
    const enabledCount = categoryMappings.filter(m => m.is_enabled).length;
    
    const rows = categoryMappings.map((mapping) => {
      const isEditing = editingMapping?.field_name === mapping.field_name && 
                       editingMapping?.category === mapping.category;

      if (isEditing && editingMapping) {
        return [
          humanizeFieldName(mapping.field_name),
          <Select
            key={`type-${mapping.field_name}`}
            label="Mapping Type"
            labelHidden
            value={editingMapping.mapping_type}
            options={mappingTypeOptions}
            onChange={(value) =>
              setEditingMapping({
                ...editingMapping,
                mapping_type: value as MappingType,
              })
            }
          />,
          <TextField
            key={`value-${mapping.field_name}`}
            label="Value"
            labelHidden
            value={
              editingMapping.mapping_type === 'constant' || editingMapping.mapping_type === 'formula'
                ? editingMapping.target_value || ''
                : editingMapping.source_value || ''
            }
            onChange={(value) => {
              if (editingMapping.mapping_type === 'constant' || editingMapping.mapping_type === 'formula') {
                setEditingMapping({
                  ...editingMapping,
                  target_value: value,
                });
              } else {
                setEditingMapping({
                  ...editingMapping,
                  source_value: value,
                });
              }
            }}
            placeholder={
              editingMapping.mapping_type === 'constant'
                ? 'Enter constant value'
                : editingMapping.mapping_type === 'shopify_field'
                ? 'Enter Shopify field name'
                : editingMapping.mapping_type === 'formula'
                ? 'Enter formula'
                : 'Value not applicable'
            }
            disabled={editingMapping.mapping_type === 'edit_in_grid'}
            autoComplete="off"
          />,
          <ButtonGroup key={`actions-${mapping.field_name}`}>
            <Button variant="primary" onClick={handleSaveMapping} loading={saving} size="slim">
              Save
            </Button>
            <Button onClick={handleCancelEdit} size="slim">
              Cancel
            </Button>
          </ButtonGroup>,
        ];
      }

      return [
        <div key={`field-${mapping.field_name}`} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{humanizeFieldName(mapping.field_name)}</span>
          {!mapping.is_enabled && <Badge tone="warning">Disabled</Badge>}
        </div>,
        mappingTypeOptions.find((opt) => opt.value === mapping.mapping_type)?.label || mapping.mapping_type,
        renderMappingValue(mapping),
        <ButtonGroup key={`actions-${mapping.field_name}`}>
          <Button
            onClick={() => handleEditMapping(mapping)}
            size="slim"
            disabled={editingMapping !== null}
            icon={EditIcon}
          >
            Edit
          </Button>
          <Tooltip content="Preview mapping flow">
            <Button
              onClick={() => handlePreviewMapping(mapping)}
              size="slim"
              icon={InfoIcon}
            />
          </Tooltip>
        </ButtonGroup>,
      ];
    });

    return (
      <Card key={category}>
        <div 
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} 
          onClick={() => toggleCategory(category)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Text variant="headingMd" as="h3">
              {humanizeCategory(category)}
            </Text>
            <Badge tone="info">{`${categoryMappings.length} mappings`}</Badge>
            <Badge tone={enabledCount === categoryMappings.length ? 'success' : 'warning'}>
              {`${enabledCount} enabled`}
            </Badge>
          </div>
          <Icon source={isOpen ? ChevronUpIcon : ChevronDownIcon} />
        </div>
        
        <Collapsible open={isOpen} id={`${category}-mappings`}>
          <div style={{ marginTop: '16px' }}>
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text']}
              headings={['Field Name', 'Mapping Type', 'Current Value', 'Actions']}
              rows={rows}
              footerContent={`${categoryMappings.length} mapping${categoryMappings.length === 1 ? '' : 's'}`}
            />
          </div>
        </Collapsible>
      </Card>
    );
  };

  const getTotalMappingsCount = () => {
    if (!mappings) return 0;
    return Object.values(mappings).reduce((total, categoryMappings) => total + categoryMappings.length, 0);
  };

  const getEnabledMappingsCount = () => {
    if (!mappings) return 0;
    return Object.values(mappings)
      .flat()
      .filter(mapping => mapping.is_enabled).length;
  };

  return (
    <Page 
      title="Mappings"
      primaryAction={
        <ButtonGroup>
          <Button onClick={() => setShowBulkModal(true)}>Bulk Update</Button>
          <Button onClick={() => setShowImportModal(true)} icon={ImportIcon}>Import</Button>
          <Button onClick={() => setShowExportModal(true)} icon={ExportIcon}>Export</Button>
        </ButtonGroup>
      }
    >
      {error && (
        <Banner tone="critical" title="Something went wrong" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}
      
      {loading && (
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Spinner accessibilityLabel="Loading mappings" size="large" />
                <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                  Loading field mappings...
                </Text>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      )}
      
      {!loading && mappings && (
        <Layout>
          <Layout.Section>
            <Card>
              <Text variant="bodyMd" as="p" tone="subdued">
                Configure how eBay listing fields are mapped from Shopify product data. 
                Click category headers to expand/collapse sections.
              </Text>
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Badge tone="info">{`${getTotalMappingsCount()} total mappings`}</Badge>
                  <Badge tone={getEnabledMappingsCount() === getTotalMappingsCount() ? 'success' : 'warning'}>
                    {`${getEnabledMappingsCount()} enabled`}
                  </Badge>
                </div>
              </div>
            </Card>
          </Layout.Section>
          
          <Layout.Section>
            <Layout>
              <Layout.Section>
                {renderCategorySection('sales', mappings.sales)}
              </Layout.Section>
              <Layout.Section>
                {renderCategorySection('listing', mappings.listing)}
              </Layout.Section>
              <Layout.Section>
                {renderCategorySection('payment', mappings.payment)}
              </Layout.Section>
              <Layout.Section>
                {renderCategorySection('shipping', mappings.shipping)}
              </Layout.Section>
            </Layout>
          </Layout.Section>
        </Layout>
      )}

      {/* Mapping Preview Modal */}
      <Modal
        open={previewMapping !== null}
        onClose={() => setPreviewMapping(null)}
        title="Mapping Preview"
        size="large"
      >
        <Modal.Section>
          {previewMapping && renderMappingFlowDiagram(previewMapping)}
        </Modal.Section>
      </Modal>

      {/* Bulk Update Modal */}
      <Modal
        open={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        title="Bulk Update Mappings"
        primaryAction={{
          content: 'Apply Updates',
          onAction: handleBulkUpdate,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setShowBulkModal(false),
        }]}
      >
        <Modal.Section>
          <TextContainer>
            <p>Provide JSON data for bulk updating multiple mappings:</p>
          </TextContainer>
          <FormLayout>
            <TextField
              label="Bulk Update JSON"
              value={bulkUpdateData}
              onChange={setBulkUpdateData}
              multiline={10}
              autoComplete="off"
              placeholder={JSON.stringify([
                {
                  category: 'listing',
                  field_name: 'title',
                  mapping_type: 'shopify_field',
                  source_value: 'product.title'
                }
              ], null, 2)}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Import Modal */}
      <Modal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Import Mappings"
        primaryAction={{
          content: 'Import Mappings',
          onAction: handleImportMappings,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setShowImportModal(false),
        }]}
      >
        <Modal.Section>
          <FormLayout>
            <div>
              <Button 
                onClick={() => fileInputRef.current?.click()} 
                icon={FileIcon}
                size="slim"
              >
                Choose File
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileImport}
                accept=".json"
                style={{ display: 'none' }}
              />
            </div>
            <TextField
              label="Import JSON Data"
              value={importData}
              onChange={setImportData}
              multiline={10}
              autoComplete="off"
              placeholder="Paste JSON data or use the file chooser above..."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Export Modal */}
      <Modal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Mappings"
        primaryAction={{
          content: 'Download Export',
          onAction: handleExportMappings,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setShowExportModal(false),
        }]}
      >
        <Modal.Section>
          <TextContainer>
            <p>Export all current mappings to a JSON file for backup or sharing.</p>
            <p>The exported file will contain all mapping configurations and can be imported later.</p>
          </TextContainer>
        </Modal.Section>
      </Modal>

      {showToast && (
        <Toast 
          content={toastMessage} 
          onDismiss={() => setShowToast(false)} 
        />
      )}
    </Page>
  );
};

export default Mappings;