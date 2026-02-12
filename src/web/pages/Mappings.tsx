import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Divider,
  DropZone,
  Icon,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
  Toast,
} from '@shopify/polaris';
import {
  ArrowRightIcon,
  ExportIcon,
  ImportIcon,
  SearchIcon,
  SaveIcon,
} from '@shopify/polaris-icons';
import {
  AttributeMapping,
  useBulkUpdateMappings,
  useMappings,
  apiClient,
} from '../hooks/useApi';
import { useAppStore } from '../store';

const SHOPIFY_FIELD_OPTIONS = [
  { label: 'Select a field', value: '' },
  {
    title: 'Product fields',
    options: [
      { label: 'Title', value: 'title' },
      { label: 'Description (body_html)', value: 'body_html' },
      { label: 'Vendor', value: 'vendor' },
      { label: 'Product type', value: 'product_type' },
      { label: 'Tags', value: 'tags' },
      { label: 'Handle', value: 'handle' },
      { label: 'Status', value: 'status' },
    ],
  },
  {
    title: 'Variant fields',
    options: [
      { label: 'SKU', value: 'variants[0].sku' },
      { label: 'Barcode', value: 'variants[0].barcode' },
      { label: 'Price', value: 'variants[0].price' },
      { label: 'Compare at price', value: 'variants[0].compare_at_price' },
      { label: 'Weight', value: 'variants[0].weight' },
      { label: 'Inventory quantity', value: 'variants[0].inventory_quantity' },
    ],
  },
  {
    title: 'Metafields',
    options: [
      { label: 'Condition', value: 'metafields.condition' },
      { label: 'Brand', value: 'metafields.brand' },
    ],
  },
  {
    title: 'Images',
    options: [
      { label: 'Main image URL', value: 'images[0].src' },
      { label: 'Featured image URL', value: 'image.src' },
    ],
  },
];

const MAPPING_TYPE_OPTIONS = [
  { label: 'Use Shopify field', value: 'shopify_field' },
  { label: 'Set constant value', value: 'constant' },
  { label: 'Edit per product', value: 'edit_in_grid' },
  { label: 'Custom formula', value: 'formula' },
];

const REQUIRED_FIELDS: Record<string, string[]> = {
  sales: ['sku', 'price'],
  listing: ['title', 'description', 'condition', 'category'],
  payment: ['accepted_payments'],
  shipping: ['shipping_cost', 'handling_time'],
};

const CATEGORY_LABELS: Record<string, string> = {
  sales: 'Sales',
  listing: 'Listing',
  payment: 'Payment',
  shipping: 'Shipping',
};

const FILTER_OPTIONS = [
  { label: 'All fields', value: 'all' },
  { label: 'Required only', value: 'required' },
  { label: 'Unmapped required', value: 'unmapped' },
  { label: 'Disabled', value: 'disabled' },
];

const formatFieldName = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const isMappingComplete = (mapping?: AttributeMapping) => {
  if (!mapping || !mapping.is_enabled) return false;
  switch (mapping.mapping_type) {
    case 'shopify_field':
      return Boolean(mapping.source_value);
    case 'constant':
    case 'formula':
      return Boolean(mapping.target_value);
    case 'edit_in_grid':
      return true;
    default:
      return false;
  }
};

const Mappings: React.FC = () => {
  const { data, isLoading, error, refetch } = useMappings();
  const bulkUpdate = useBulkUpdateMappings();
  const {
    setUnsavedMappingChange,
    removeUnsavedMappingChange,
    clearUnsavedMappingChanges,
    setSavingMappings,
  } = useAppStore();

  const [selectedTab, setSelectedTab] = useState(0);
  const [searchValue, setSearchValue] = useState('');
  const [filterValue, setFilterValue] = useState('all');
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, Partial<AttributeMapping>>>(
    new Map(),
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const debounceRef = useRef<number | null>(null);

  const categories = useMemo(() => Object.keys(CATEGORY_LABELS), []);

  const mappingIndex = useMemo(() => {
    const map = new Map<string, AttributeMapping>();
    if (!data) return map;
    categories.forEach((category) => {
      data[category as keyof typeof data]?.forEach((mapping) => {
        map.set(`${category}:${mapping.field_name}`, mapping);
      });
    });
    return map;
  }, [data, categories]);

  const mergedMapping = useCallback(
    (mapping: AttributeMapping) => {
      const key = `${mapping.category}:${mapping.field_name}`;
      const pending = pendingUpdates.get(key) ?? {};
      return { ...mapping, ...pending };
    },
    [pendingUpdates],
  );

  const applyUpdates = useCallback(
    (mapping: AttributeMapping, updates: Partial<AttributeMapping>) => {
      const key = `${mapping.category}:${mapping.field_name}`;
      setPendingUpdates((prev) => {
        const next = new Map(prev);
        next.set(key, { ...(next.get(key) ?? {}), ...updates });
        return next;
      });
      setUnsavedMappingChange(key, updates as Record<string, unknown>);
    },
    [setUnsavedMappingChange],
  );

  const saveMappings = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      setSavingMappings(true);
      const payload: AttributeMapping[] = keys
        .map((key) => {
          const base = mappingIndex.get(key);
          const updates = pendingUpdates.get(key) ?? {};
          if (!base) return null;
          return { ...base, ...updates } as AttributeMapping;
        })
        .filter(Boolean) as AttributeMapping[];

      if (payload.length === 0) return;

      bulkUpdate.mutate(payload, {
        onSuccess: () => {
          setPendingUpdates((prev) => {
            const next = new Map(prev);
            keys.forEach((key) => next.delete(key));
            return next;
          });
          keys.forEach((key) => removeUnsavedMappingChange(key));
          setSavingMappings(false);
          setToastMessage('Mappings saved');
        },
        onError: (err) => {
          setSavingMappings(false);
          setToastMessage(err instanceof Error ? err.message : 'Failed to save mappings');
        },
      });
    },
    [bulkUpdate, mappingIndex, pendingUpdates, removeUnsavedMappingChange, setSavingMappings],
  );

  useEffect(() => {
    if (pendingUpdates.size === 0) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      const keys = Array.from(pendingUpdates.keys());
      void saveMappings(keys);
    }, 800);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [pendingUpdates, saveMappings]);

  const tabDefinitions = useMemo(() => {
    return categories.map((category) => {
      const required = REQUIRED_FIELDS[category] ?? [];
      const unmappedCount = required.reduce((count, field) => {
        const mapping = mappingIndex.get(`${category}:${field}`);
        return count + (isMappingComplete(mapping) ? 0 : 1);
      }, 0);

      return {
        id: category,
        content: CATEGORY_LABELS[category],
        accessibilityLabel: `${CATEGORY_LABELS[category]} mappings`,
        badge: unmappedCount > 0 ? String(unmappedCount) : undefined,
      };
    });
  }, [categories, mappingIndex]);

  const currentCategory = categories[selectedTab];
  const currentMappings = useMemo(() => {
    const categoryMappings = data?.[currentCategory as keyof typeof data] ?? [];

    return categoryMappings.filter((mapping) => {
      const nameMatch = mapping.field_name.toLowerCase().includes(searchValue.toLowerCase());
      if (!nameMatch) return false;

      if (filterValue === 'required') {
        return (REQUIRED_FIELDS[currentCategory] ?? []).includes(mapping.field_name);
      }
      if (filterValue === 'disabled') {
        return !mergedMapping(mapping).is_enabled;
      }
      if (filterValue === 'unmapped') {
        return (REQUIRED_FIELDS[currentCategory] ?? []).includes(mapping.field_name)
          ? !isMappingComplete(mergedMapping(mapping))
          : false;
      }
      return true;
    });
  }, [currentCategory, data, filterValue, mergedMapping, searchValue]);

  const unmappedRequiredCount = useMemo(() => {
    const required = REQUIRED_FIELDS[currentCategory] ?? [];
    return required.reduce((count, field) => {
      const mapping = mappingIndex.get(`${currentCategory}:${field}`);
      return count + (isMappingComplete(mapping) ? 0 : 1);
    }, 0);
  }, [currentCategory, mappingIndex]);

  const handleExport = async () => {
    try {
      const response = await fetch('/api/mappings/export');
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mappings-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
      setExportModalOpen(false);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    try {
      const content = await importFile.text();
      const parsed = JSON.parse(content) as { mappings?: AttributeMapping[] } | AttributeMapping[];
      const mappings = Array.isArray(parsed) ? parsed : parsed.mappings ?? [];
      await apiClient.post('/mappings/import', { mappings });
      setImportModalOpen(false);
      setImportFile(null);
      clearUnsavedMappingChanges();
      refetch();
      setToastMessage('Mappings imported');
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Import failed');
    }
  };

  if (isLoading) {
    return (
      <Page title="Field mappings" fullWidth>
        <Card>
          <Box padding="600">
            <InlineStack align="center">
              <Spinner accessibilityLabel="Loading mappings" size="large" />
            </InlineStack>
          </Box>
        </Card>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Field mappings" fullWidth>
        <Banner tone="critical" title="Failed to load mappings">
          <BlockStack gap="200">
            <Text as="p">{(error as Error).message}</Text>
            <Button onClick={() => refetch()}>Try again</Button>
          </BlockStack>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Field mappings"
      subtitle="Configure how Shopify fields map to eBay listing attributes"
      fullWidth
      primaryAction={{
        content: 'Save changes',
        icon: SaveIcon,
        onAction: () => saveMappings(Array.from(pendingUpdates.keys())),
        disabled: pendingUpdates.size === 0,
        loading: bulkUpdate.isPending,
      }}
      secondaryActions={[
        {
          content: 'Export',
          icon: ExportIcon,
          onAction: () => setExportModalOpen(true),
        },
        {
          content: 'Import',
          icon: ImportIcon,
          onAction: () => setImportModalOpen(true),
        },
      ]}
    >
      {pendingUpdates.size > 0 && (
        <Banner tone="info" title="Auto-save is enabled">
          <Text as="p">We will save your changes automatically.</Text>
        </Banner>
      )}

      <Card>
        <BlockStack gap="400">
          <InlineStack gap="400" align="space-between">
            <Box minWidth="280px">
              <TextField
                label="Search fields"
                labelHidden
                value={searchValue}
                onChange={setSearchValue}
                prefix={<Icon source={SearchIcon} />}
                placeholder="Search fields"
                clearButton
                onClearButtonClick={() => setSearchValue('')}
                autoComplete="off"
              />
            </Box>
            <Box minWidth="220px">
              <Select
                label="Filter"
                labelHidden
                options={FILTER_OPTIONS}
                value={filterValue}
                onChange={setFilterValue}
              />
            </Box>
          </InlineStack>

          <Divider />

          <Tabs tabs={tabDefinitions} selected={selectedTab} onSelect={setSelectedTab}>
            <Box paddingBlockStart="400">
              <BlockStack gap="300">
                <InlineStack gap="200" align="space-between">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      {CATEGORY_LABELS[currentCategory]} mappings
                    </Text>
                    <Text as="p" tone="subdued">
                      {currentMappings.length} fields · {unmappedRequiredCount} required unmapped
                    </Text>
                  </BlockStack>
                  <Badge tone={unmappedRequiredCount > 0 ? 'critical' : 'success'}>
                    {unmappedRequiredCount > 0 ? 'Action needed' : 'Complete'}
                  </Badge>
                </InlineStack>

                <IndexTable
                  resourceName={{ singular: 'mapping', plural: 'mappings' }}
                  itemCount={currentMappings.length}
                  selectable={false}
                  headings={[
                    { title: 'Field name' },
                    { title: '' },
                    { title: 'Mapping type' },
                    { title: 'Configuration' },
                    { title: 'Enabled' },
                  ]}
                >
                  {currentMappings.map((mapping, index) => {
                    const merged = mergedMapping(mapping);
                    const required = (REQUIRED_FIELDS[mapping.category] ?? []).includes(mapping.field_name);

                    return (
                      <IndexTable.Row id={`${mapping.category}-${mapping.field_name}`} key={`${mapping.category}-${mapping.field_name}`} position={index}>
                        <IndexTable.Cell>
                          <InlineStack gap="200" align="center">
                            <Text variant="bodyMd" fontWeight="semibold" as="span">
                              {formatFieldName(mapping.field_name)}
                            </Text>
                            {required && (
                              <Badge tone="critical" size="small">
                                Required
                              </Badge>
                            )}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Icon source={ArrowRightIcon} tone="subdued" />
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Select
                            label="Mapping type"
                            labelHidden
                            options={MAPPING_TYPE_OPTIONS}
                            value={merged.mapping_type}
                            onChange={(value) => {
                              const updates: Partial<AttributeMapping> = {
                                mapping_type: value as AttributeMapping['mapping_type'],
                              };
                              if (value === 'shopify_field') {
                                updates.source_value = '';
                                updates.target_value = null;
                              } else if (value === 'constant') {
                                updates.target_value = '';
                                updates.source_value = null;
                              } else if (value === 'formula') {
                                updates.target_value = '';
                                updates.source_value = null;
                              } else {
                                updates.source_value = null;
                                updates.target_value = null;
                              }
                              applyUpdates(mapping, updates);
                            }}
                          />
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Box minWidth="220px">
                            {merged.mapping_type === 'shopify_field' && (
                              <Select
                                label="Shopify field"
                                labelHidden
                                options={SHOPIFY_FIELD_OPTIONS}
                                value={merged.source_value ?? ''}
                                onChange={(value) => applyUpdates(mapping, { source_value: value })}
                              />
                            )}
                            {merged.mapping_type === 'constant' && (
                              <TextField
                                label="Constant value"
                                labelHidden
                                value={merged.target_value ?? ''}
                                onChange={(value) => applyUpdates(mapping, { target_value: value })}
                                placeholder="Enter value"
                                autoComplete="off"
                              />
                            )}
                            {merged.mapping_type === 'formula' && (
                              <TextField
                                label="Formula"
                                labelHidden
                                value={merged.target_value ?? ''}
                                onChange={(value) => applyUpdates(mapping, { target_value: value })}
                                placeholder="e.g. {{title}} - {{sku}}"
                                helpText="Use {{field}} tokens for Shopify fields"
                                autoComplete="off"
                              />
                            )}
                            {merged.mapping_type === 'edit_in_grid' && (
                              <Text as="p" tone="subdued">
                                Edit per product in the listings grid.
                              </Text>
                            )}
                          </Box>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Checkbox
                            label="Enabled"
                            labelHidden
                            checked={merged.is_enabled}
                            onChange={(value) => applyUpdates(mapping, { is_enabled: value })}
                          />
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              </BlockStack>
            </Box>
          </Tabs>
        </BlockStack>
      </Card>

      <Modal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Export mappings"
        primaryAction={{ content: 'Export', onAction: handleExport }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setExportModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">Download all mappings as a JSON file.</Text>
            <Text as="p" tone="subdued">
              Use this export to back up or move mappings between stores.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import mappings"
        primaryAction={{ content: 'Import', onAction: handleImport, disabled: !importFile }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setImportModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">Upload a JSON export to replace existing mappings.</Text>
            <DropZone
              accept="application/json"
              onDrop={(files) => setImportFile(files[0] ?? null)}
              allowMultiple={false}
            >
              <DropZone.FileUpload actionTitle="Add JSON file" actionHint="or drop a file" />
            </DropZone>
            {importFile && (
              <Banner tone="warning" title="Import will overwrite all mappings">
                <Text as="p">Selected file: {importFile.name}</Text>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
};

export default Mappings;
