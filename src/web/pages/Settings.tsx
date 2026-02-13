import React, { useMemo, useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  Select,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
import { LinkIcon, RefreshIcon } from '@shopify/polaris-icons';
import { apiClient, useEbayAuthStatus, useSettings, useStatus, useUpdateSettings } from '../hooks/useApi';
import { useAppStore } from '../store';

const Settings: React.FC = () => {
  const { data: settings, isLoading, error } = useSettings();
  useStatus(); // Populates connection status in the store
  const { data: ebayAuth, isLoading: ebayLoading, refetch: refetchEbay } = useEbayAuthStatus();
  const updateSettings = useUpdateSettings();
  const { connections } = useAppStore();

  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  const mergedSettings = useMemo(() => ({
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
  }), [settings, draft]);

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

  if (isLoading) {
    return (
      <Page title="Settings">
        <Card>
          <Box padding="600">
            <InlineStack align="center">
              <Spinner size="large" accessibilityLabel="Loading settings" />
            </InlineStack>
          </Box>
        </Card>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Settings">
        <Card>
          <BlockStack gap="200">
            <Text variant="headingMd" as="h2">Settings unavailable</Text>
            <Text as="p">{(error as Error).message}</Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  const photoroomKeyConfigured = Boolean(settings?.photoroom_api_key_configured === 'true' || process.env.PHOTOROOM_API_KEY);

  return (
    <Page
      title="Settings"
      subtitle="Sync configuration and platform connections"
      primaryAction={{
        content: 'Save settings',
        onAction: handleSave,
        loading: updateSettings.isPending,
      }}
    >
      <Layout>
        {/* ── Sync Configuration ──────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Sync configuration</Text>
              <InlineStack gap="400" wrap>
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
              </InlineStack>
              <Box maxWidth="240px">
                <Select
                  label="Sync interval (minutes)"
                  options={[
                    { label: '5', value: '5' },
                    { label: '10', value: '10' },
                    { label: '15', value: '15' },
                    { label: '30', value: '30' },
                  ]}
                  value={String(mergedSettings.sync_interval_minutes)}
                  onChange={(value) => setDraft((prev) => ({ ...prev, sync_interval_minutes: value }))}
                />
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Shopify — Description Prompt ─────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Shopify</Text>
              <Text tone="subdued" as="p">
                Configure AI description generation for the auto-listing pipeline.
              </Text>
              <TextField
                label="Description Generation Prompt"
                value={String(mergedSettings.description_prompt)}
                onChange={(value) => setDraft((prev) => ({ ...prev, description_prompt: value }))}
                multiline={10}
                autoComplete="off"
                helpText="This prompt is sent to the AI when generating product descriptions for new listings."
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── PhotoRoom ────────────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">PhotoRoom</Text>
              <Text tone="subdued" as="p">
                Image processing settings for product photos.
              </Text>
              <TextField
                label="Template ID"
                value={String(mergedSettings.photoroom_template_id)}
                onChange={(value) => setDraft((prev) => ({ ...prev, photoroom_template_id: value }))}
                autoComplete="off"
                helpText="The PhotoRoom template used to render product images."
              />
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodyMd">API key status:</Text>
                <Badge tone={photoroomKeyConfigured ? 'success' : 'critical'}>
                  {photoroomKeyConfigured ? 'Configured' : 'Not configured'}
                </Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Pipeline ─────────────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Pipeline</Text>
              <Text tone="subdued" as="p">
                Control automatic processing for new products entering the pipeline.
              </Text>
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
          </Card>
        </Layout.Section>

        {/* ── Shopify Connection ────────────────────────────────────── */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h3">Shopify connection</Text>
                <Badge tone={connections.shopify ? 'success' : 'critical'}>
                  {connections.shopify ? 'Connected' : 'Disconnected'}
                </Badge>
              </InlineStack>
              <Text tone="subdued" as="p">
                Connect Shopify to sync products and inventory.
              </Text>
              <Button icon={LinkIcon} onClick={handleConnectShopify}>
                Connect Shopify
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── eBay Connection ──────────────────────────────────────── */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h3">eBay connection</Text>
                <Badge tone={ebayAuth?.connected ? 'success' : 'critical'}>
                  {ebayAuth?.connected ? 'Connected' : 'Disconnected'}
                </Badge>
              </InlineStack>
              {ebayLoading ? (
                <Spinner size="small" />
              ) : (
                <Text tone="subdued" as="p">
                  {ebayAuth?.connected ? 'eBay account authorized.' : 'Authorize your eBay account.'}
                </Text>
              )}
              <InlineStack gap="200">
                <Button icon={LinkIcon} onClick={handleConnectEbay}>
                  {ebayAuth?.connected ? 'Reconnect eBay' : 'Connect eBay'}
                </Button>
                <Button icon={RefreshIcon} onClick={() => refetchEbay()}>
                  Refresh
                </Button>
                {ebayAuth?.connected && (
                  <Button tone="critical" onClick={handleDisconnectEbay}>
                    Disconnect
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default Settings;
