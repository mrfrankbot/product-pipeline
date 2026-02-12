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
} from '@shopify/polaris';
import { LinkIcon, RefreshIcon } from '@shopify/polaris-icons';
import { apiClient, useEbayAuthStatus, useSettings, useUpdateSettings } from '../hooks/useApi';
import { useAppStore } from '../store';

const Settings: React.FC = () => {
  const { data: settings, isLoading, error } = useSettings();
  const { data: ebayAuth, isLoading: ebayLoading, refetch: refetchEbay } = useEbayAuthStatus();
  const updateSettings = useUpdateSettings();
  const { connections } = useAppStore();

  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  const mergedSettings = useMemo(() => ({
    auto_sync_enabled: settings?.auto_sync_enabled ?? 'false',
    sync_interval_minutes: settings?.sync_interval_minutes ?? '5',
    sync_inventory: settings?.sync_inventory ?? 'true',
    sync_price: settings?.sync_price ?? 'true',
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
                  {ebayAuth?.user ? `Signed in as ${ebayAuth.user}` : 'Authorize your eBay account.'}
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
