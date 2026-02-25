import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Layout,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonPage,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
import { LinkIcon, RefreshIcon, DeleteIcon, PlusIcon } from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, useEbayAuthStatus, useSettings, useStatus, useUpdateSettings } from '../hooks/useApi';
import { useAppStore } from '../store';

// ── Types ──────────────────────────────────────────────────────────────

interface ConditionDescriptions {
  [grade: string]: string;
}

interface CategoryRule {
  categoryId: string;
  name: string;
  keywords: string[];
  priority: number;
}

// ── Hardcoded defaults (mirrors config files) ──────────────────────────

const DEFAULT_CONDITION_DESCRIPTIONS: ConditionDescriptions = {
  'Mint / Like New': 'Virtually indistinguishable from new. No visible wear, perfect optics.',
  'Like New Minus': 'Near-perfect with only the faintest handling marks. Optics pristine.',
  'Excellent Plus': 'Light signs of normal use, minor cosmetic marks. Optics clean, no haze/fungus/scratches.',
  Excellent: 'Normal cosmetic wear consistent with regular use. All functions work perfectly. Optics clear.',
  'Excellent Minus': 'Moderate cosmetic wear, possible light marks on barrel. Optics clean and functional.',
  'Good Plus': 'Visible wear and cosmetic marks. Fully functional, optics may show minor dust (does not affect image quality).',
  Good: 'Heavy wear, possible brassing or paint loss. Fully functional.',
  'Open Box': 'This item has been opened and inspected but shows no signs of use. Includes all original packaging and accessories.',
};

const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  { categoryId: '31388', name: 'Digital Cameras', keywords: ['digital camera', 'dslr', 'mirrorless', 'camera body', 'camera'], priority: 100 },
  { categoryId: '3323', name: 'Camera Lenses', keywords: ['lens', 'lenses', 'prime lens', 'zoom lens', 'wide angle', 'telephoto'], priority: 90 },
  { categoryId: '4201', name: 'Film Photography Film', keywords: ['camera film', 'film', '35mm film', 'instant', 'polaroid film', 'instax'], priority: 85 },
  { categoryId: '78997', name: 'Film Photography Cameras', keywords: ['film camera', 'film slr', '35mm camera', 'rangefinder', 'medium format camera'], priority: 80 },
  { categoryId: '183331', name: 'Flashes & Flash Accessories', keywords: ['flash', 'speedlight', 'speedlite', 'strobe'], priority: 75 },
  { categoryId: '30090', name: 'Tripods & Monopods', keywords: ['tripod', 'monopod', 'gimbal', 'stabilizer'], priority: 70 },
  { categoryId: '29982', name: 'Camera Bags & Cases', keywords: ['bag', 'case', 'backpack', 'camera bag'], priority: 65 },
  { categoryId: '48446', name: 'Binoculars & Telescopes', keywords: ['binocular', 'binoculars', 'telescope', 'spotting scope'], priority: 60 },
  { categoryId: '48528', name: 'Camera Filters', keywords: ['filter', 'uv filter', 'nd filter', 'polarizer', 'cpl'], priority: 55 },
  { categoryId: '48444', name: 'Other Camera Accessories', keywords: ['accessory', 'accessories', 'strap', 'remote', 'adapter', 'battery', 'charger'], priority: 50 },
];

// ── Main Component ─────────────────────────────────────────────────────

const Settings: React.FC = () => {
  const { data: settings, isLoading, error } = useSettings();
  useStatus();
  const { data: ebayAuth, isLoading: ebayLoading, refetch: refetchEbay } = useEbayAuthStatus();
  const updateSettings = useUpdateSettings();
  const { connections } = useAppStore();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  // ── Condition descriptions state ──────────────────────────────────────
  const { data: condDescData } = useQuery({
    queryKey: ['condition-descriptions'],
    queryFn: () => apiClient.get<ConditionDescriptions>('/settings/condition-descriptions'),
  });
  const [condDraft, setCondDraft] = useState<ConditionDescriptions>({});
  const [condSaveStatus, setCondSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const condDescriptions = useMemo(
    () => ({ ...DEFAULT_CONDITION_DESCRIPTIONS, ...(condDescData ?? {}), ...condDraft }),
    [condDescData, condDraft],
  );

  const saveCondDescMutation = useMutation({
    mutationFn: (data: ConditionDescriptions) =>
      apiClient.put<{ ok: boolean }>('/settings/condition-descriptions', data),
    onSuccess: () => {
      setCondSaveStatus('saved');
      setCondDraft({});
      queryClient.invalidateQueries({ queryKey: ['condition-descriptions'] });
      setTimeout(() => setCondSaveStatus('idle'), 3000);
    },
    onError: () => {
      setCondSaveStatus('error');
      setTimeout(() => setCondSaveStatus('idle'), 4000);
    },
  });

  const handleSaveCondDesc = () => {
    setCondSaveStatus('saving');
    saveCondDescMutation.mutate(condDescriptions);
  };

  // ── Category rules state ──────────────────────────────────────────────
  const { data: categoryData } = useQuery({
    queryKey: ['ebay-categories'],
    queryFn: () => apiClient.get<CategoryRule[]>('/settings/ebay-categories'),
  });
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [catSaveStatus, setCatSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Sync category rules when API data loads
  useEffect(() => {
    if (categoryData && categoryRules.length === 0) {
      setCategoryRules(categoryData);
    }
  }, [categoryData]);

  // Initialize from defaults if no API data
  const displayCategoryRules = categoryRules.length > 0
    ? categoryRules
    : (categoryData ?? DEFAULT_CATEGORY_RULES);

  const saveCatMutation = useMutation({
    mutationFn: (data: CategoryRule[]) =>
      apiClient.put<{ ok: boolean }>('/settings/ebay-categories', data),
    onSuccess: () => {
      setCatSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ['ebay-categories'] });
      setTimeout(() => setCatSaveStatus('idle'), 3000);
    },
    onError: () => {
      setCatSaveStatus('error');
      setTimeout(() => setCatSaveStatus('idle'), 4000);
    },
  });

  const handleSaveCategories = () => {
    setCatSaveStatus('saving');
    saveCatMutation.mutate(displayCategoryRules);
  };

  const handleCategoryChange = (idx: number, field: keyof CategoryRule, value: string | string[] | number) => {
    setCategoryRules((prev) => {
      const next = [...(prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES)];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleAddCategory = () => {
    setCategoryRules((prev) => [
      ...(prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES),
      { categoryId: '', name: 'New Category', keywords: [], priority: 10 },
    ]);
  };

  const handleDeleteCategory = (idx: number) => {
    setCategoryRules((prev) => {
      const source = prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES;
      return source.filter((_, i) => i !== idx);
    });
  };

  // ── Merged settings ───────────────────────────────────────────────────
  const mergedSettings = useMemo(
    () => ({
      auto_sync_enabled: settings?.auto_sync_enabled ?? 'false',
      sync_interval_minutes: settings?.sync_interval_minutes ?? '5',
      sync_inventory: settings?.sync_inventory ?? 'true',
      sync_price: settings?.sync_price ?? 'true',
      description_prompt: settings?.description_prompt ?? '',
      photoroom_template_id: settings?.photoroom_template_id ?? '',
      pipeline_auto_descriptions: settings?.pipeline_auto_descriptions ?? '0',
      pipeline_auto_images: settings?.pipeline_auto_images ?? '0',
      ...settings,
      ...draft,
    }),
    [settings, draft],
  );

  const handleSave = () => {
    updateSettings.mutate(mergedSettings as Record<string, string>);
  };

  const handleConnectShopify = () => {
    window.open('/auth', '_blank', 'width=600,height=700');
  };

  const handleConnectEbay = () => {
    window.open('/ebay/auth', '_blank', 'width=600,height=700');
  };

  const handleDisconnectEbay = async () => {
    await apiClient.delete('/ebay/auth');
    refetchEbay();
  };

  const photoroomKeyConfigured = Boolean(
    settings?.photoroom_api_key_configured === 'true' || process.env.PHOTOROOM_API_KEY,
  );

  // ── Loading / error states ────────────────────────────────────────────
  if (isLoading) {
    return (
      <SkeletonPage title="Settings">
        <Layout>
          <Layout.AnnotatedSection title="Connections" description="Loading...">
            <Card>
              <SkeletonBodyText lines={4} />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </SkeletonPage>
    );
  }

  if (error) {
    return (
      <Page title="Settings">
        <Banner tone="critical" title="Settings unavailable">
          <p>{(error as Error).message}</p>
        </Banner>
      </Page>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Page title="Settings">
      <Layout>
        {/* ── Connections ─────────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Connections"
          description="Platform integrations and authentication"
        >
          <BlockStack gap="400">
            {/* Shopify */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h3">🛍️ Shopify</Text>
                    <Badge tone={connections.shopify ? 'success' : 'critical'}>
                      {connections.shopify ? 'Connected' : 'Disconnected'}
                    </Badge>
                  </InlineStack>
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  Connect Shopify to sync products, inventory, and pricing.
                </Text>
                <Button icon={LinkIcon} onClick={handleConnectShopify} size="slim">
                  Connect Shopify
                </Button>
              </BlockStack>
            </Card>

            {/* eBay */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h3">🛒 eBay</Text>
                    {ebayLoading ? (
                      <Spinner size="small" accessibilityLabel="Checking eBay status" />
                    ) : (
                      <Badge tone={ebayAuth?.connected ? 'success' : 'critical'}>
                        {ebayAuth?.connected ? 'Connected' : 'Disconnected'}
                      </Badge>
                    )}
                  </InlineStack>
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  {ebayAuth?.connected
                    ? 'eBay account is authorized. Products will sync automatically.'
                    : 'Authorize your eBay seller account to enable listing sync.'}
                </Text>
                <InlineStack gap="200">
                  <Button icon={LinkIcon} onClick={handleConnectEbay} size="slim">
                    {ebayAuth?.connected ? 'Reconnect eBay' : 'Connect eBay'}
                  </Button>
                  <Button icon={RefreshIcon} onClick={() => refetchEbay()} size="slim">
                    Refresh
                  </Button>
                  {ebayAuth?.connected && (
                    <Button tone="critical" onClick={handleDisconnectEbay} size="slim">
                      Disconnect
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.AnnotatedSection>

        {/* ── Sync ────────────────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Sync"
          description="Control how and when products sync between Shopify and eBay"
        >
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Checkbox
                  label="Auto-sync enabled"
                  checked={String(mergedSettings.auto_sync_enabled) === 'true'}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, auto_sync_enabled: value ? 'true' : 'false' }))
                  }
                />
                <Checkbox
                  label="Sync inventory"
                  checked={String(mergedSettings.sync_inventory) === 'true'}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, sync_inventory: value ? 'true' : 'false' }))
                  }
                />
                <Checkbox
                  label="Sync price"
                  checked={String(mergedSettings.sync_price) === 'true'}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, sync_price: value ? 'true' : 'false' }))
                  }
                />
              </BlockStack>
              <Box maxWidth="200px">
                <Select
                  label="Sync interval (minutes)"
                  options={[
                    { label: '5 minutes', value: '5' },
                    { label: '10 minutes', value: '10' },
                    { label: '15 minutes', value: '15' },
                    { label: '30 minutes', value: '30' },
                  ]}
                  value={String(mergedSettings.sync_interval_minutes)}
                  onChange={(value) => setDraft((prev) => ({ ...prev, sync_interval_minutes: value }))}
                />
              </Box>
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={updateSettings.isPending}
                  size="slim"
                >
                  Save sync settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── Pipeline ────────────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Pipeline"
          description="Automatic processing steps for new products entering the pipeline"
        >
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Checkbox
                  label="Auto-generate descriptions on new products"
                  checked={String(mergedSettings.pipeline_auto_descriptions) === '1'}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, pipeline_auto_descriptions: value ? '1' : '0' }))
                  }
                />
                <Checkbox
                  label="Auto-process images on new products"
                  checked={String(mergedSettings.pipeline_auto_images) === '1'}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, pipeline_auto_images: value ? '1' : '0' }))
                  }
                />
              </BlockStack>
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={updateSettings.isPending}
                  size="slim"
                >
                  Save pipeline settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── Photo Processing ─────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Photo Processing"
          description="PhotoRoom integration and image template settings"
        >
          <Card>
            <BlockStack gap="400">
              <TextField
                label="PhotoRoom Template ID"
                value={String(mergedSettings.photoroom_template_id)}
                onChange={(value) => setDraft((prev) => ({ ...prev, photoroom_template_id: value }))}
                autoComplete="off"
                helpText="The PhotoRoom template used to render product images."
              />
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodySm" as="span" tone="subdued">PhotoRoom API key:</Text>
                <Badge tone={photoroomKeyConfigured ? 'success' : 'critical'}>
                  {photoroomKeyConfigured ? 'Configured' : 'Not configured'}
                </Badge>
              </InlineStack>
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={updateSettings.isPending}
                  size="slim"
                >
                  Save photo settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── eBay ─────────────────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="eBay"
          description="Condition descriptions, category mappings, and listing defaults"
        >
          <BlockStack gap="400">
            {/* Condition Descriptions */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">Condition Grade Descriptions</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Edit the descriptions shown on eBay listings for each condition grade. These appear as the item condition notes visible to buyers.
                </Text>
                <BlockStack gap="300">
                  {Object.entries(condDescriptions).map(([grade, desc]) => (
                    <BlockStack key={grade} gap="100">
                      <Text variant="bodyMd" as="span" fontWeight="semibold">{grade}</Text>
                      <TextField
                        label=""
                        labelHidden
                        value={desc}
                        onChange={(val) =>
                          setCondDraft((prev) => ({ ...prev, [grade]: val }))
                        }
                        multiline={2}
                        autoComplete="off"
                      />
                    </BlockStack>
                  ))}
                </BlockStack>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodySm" as="span" tone={condSaveStatus === 'saved' ? 'success' : condSaveStatus === 'error' ? 'critical' : 'subdued'}>
                    {condSaveStatus === 'saved' && '✓ Saved'}
                    {condSaveStatus === 'error' && '✗ Failed to save'}
                  </Text>
                  <Button
                    variant="primary"
                    onClick={handleSaveCondDesc}
                    loading={condSaveStatus === 'saving'}
                    size="slim"
                  >
                    Save descriptions
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Category Mappings */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">eBay Category Mappings</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Map Shopify product types to eBay category IDs. Keywords are matched against the product type (comma-separated, lowercased).
                </Text>
                <BlockStack gap="300">
                  {displayCategoryRules.map((rule, idx) => (
                    <Card key={idx}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="bodyMd" as="span" fontWeight="semibold">
                            {rule.name || `Category ${idx + 1}`}
                          </Text>
                          <Button
                            icon={DeleteIcon}
                            onClick={() => handleDeleteCategory(idx)}
                            tone="critical"
                            variant="plain"
                            accessibilityLabel="Remove category"
                          />
                        </InlineStack>
                        <InlineStack gap="200" wrap>
                          <Box minWidth="180px" maxWidth="240px">
                            <TextField
                              label="Category Name"
                              value={rule.name}
                              onChange={(val) => handleCategoryChange(idx, 'name', val)}
                              autoComplete="off"
                            />
                          </Box>
                          <Box minWidth="120px" maxWidth="140px">
                            <TextField
                              label="eBay ID"
                              value={rule.categoryId}
                              onChange={(val) => handleCategoryChange(idx, 'categoryId', val)}
                              placeholder="e.g. 31388"
                              autoComplete="off"
                            />
                          </Box>
                          <Box minWidth="80px" maxWidth="100px">
                            <TextField
                              label="Priority"
                              type="number"
                              value={String(rule.priority)}
                              onChange={(val) => handleCategoryChange(idx, 'priority', parseInt(val) || 0)}
                              autoComplete="off"
                            />
                          </Box>
                        </InlineStack>
                        <TextField
                          label="Keywords"
                          value={Array.isArray(rule.keywords) ? rule.keywords.join(', ') : rule.keywords}
                          onChange={(val) =>
                            handleCategoryChange(idx, 'keywords', val.split(',').map((k) => k.trim()).filter(Boolean))
                          }
                          placeholder="camera, dslr, mirrorless…"
                          autoComplete="off"
                        />
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
                <Button icon={PlusIcon} onClick={handleAddCategory} variant="plain" size="slim">
                  Add category
                </Button>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodySm" as="span" tone={catSaveStatus === 'saved' ? 'success' : catSaveStatus === 'error' ? 'critical' : 'subdued'}>
                    {catSaveStatus === 'saved' && '✓ Saved'}
                    {catSaveStatus === 'error' && '✗ Failed to save'}
                  </Text>
                  <Button
                    variant="primary"
                    onClick={handleSaveCategories}
                    loading={catSaveStatus === 'saving'}
                    size="slim"
                  >
                    Save categories
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.AnnotatedSection>

        {/* ── AI Descriptions ──────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="AI Descriptions"
          description="Configure the AI prompt used to generate eBay listing descriptions"
        >
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodySm" as="span" tone="subdued">OpenAI API key:</Text>
                <Badge tone={settings?.openai_api_key_configured === 'true' ? 'success' : 'critical'}>
                  {settings?.openai_api_key_configured === 'true' ? 'Configured' : 'Not configured'}
                </Badge>
              </InlineStack>
              <TextField
                label="Description Generation Prompt"
                value={String(mergedSettings.description_prompt)}
                onChange={(value) => setDraft((prev) => ({ ...prev, description_prompt: value }))}
                multiline={10}
                autoComplete="off"
                helpText="This prompt is sent to the AI when generating product descriptions for new listings."
              />
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={updateSettings.isPending}
                  size="slim"
                >
                  Save prompt
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>
      </Layout>
    </Page>
  );
};

export default Settings;
