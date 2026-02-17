import React, { useCallback, useState } from 'react';
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  Page,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
import { ImageIcon, CheckCircleIcon, AlertCircleIcon } from '@shopify/polaris-icons';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../hooks/useApi';
import TemplateManager from '../components/TemplateManager';

interface ImageStatusResponse {
  configured: boolean;
  apiKey: boolean;
}

interface ProcessResponse {
  ok: boolean;
  productId: string;
  originalCount: number;
  processedCount: number;
  images: string[];
}

const ImageProcessor: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get('category') || undefined;
  
  const [productId, setProductId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['images-status'],
    queryFn: () => apiClient.get<ImageStatusResponse>('/images/status'),
    staleTime: 60000,
  });

  const handleProcess = useCallback(async () => {
    if (!productId.trim()) return;
    setProcessing(true);
    setResult(null);
    setError(null);

    try {
      const res = await apiClient.post<ProcessResponse>(
        `/images/process/${productId.trim()}`,
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setProcessing(false);
    }
  }, [productId]);

  if (statusLoading) {
    return (
      <Page title="Image Processor" fullWidth>
        <Card>
          <Box padding="400">
            <InlineStack align="center" gap="200">
              <Spinner size="small" />
              <Text as="span" variant="bodyMd">
                Checking PhotoRoom status…
              </Text>
            </InlineStack>
          </Box>
        </Card>
      </Page>
    );
  }

  return (
    <Page 
      title="Image Processor" 
      subtitle="PhotoRoom background removal & product image processing" 
      fullWidth
    >
      <BlockStack gap="500">
        
        {/* ── Status Overview ── */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              <Box
                background={status?.configured ? 'bg-fill-success-secondary' : 'bg-fill-warning-secondary'}
                borderRadius="200"
                padding="200"
              >
                <Icon
                  source={status?.configured ? CheckCircleIcon : AlertCircleIcon}
                  tone={status?.configured ? 'success' : 'warning'}
                />
              </Box>
              <BlockStack gap="050">
                <Text variant="headingSm" as="h2">
                  PhotoRoom Integration
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {status?.configured 
                    ? 'API configured and ready'
                    : 'Setup required'}
                </Text>
              </BlockStack>
            </InlineStack>
          </InlineStack>
        </Card>

        {/* ── Configuration Status ── */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Configuration</Text>
            
            <Divider />

            {status?.configured ? (
              <Banner tone="success" title="PhotoRoom API Ready">
                <Text as="p">
                  PhotoRoom API is configured and ready to use for automatic image processing.
                </Text>
              </Banner>
            ) : (
              <Banner tone="warning" title="Setup Required">
                <BlockStack gap="200">
                  <Text as="p">
                    PhotoRoom API is not configured. Set the{' '}
                    <code>PHOTOROOM_API_KEY</code> environment variable to
                    enable automatic image processing.
                  </Text>
                  <Text tone="subdued" as="p">
                    Get your API key at{' '}
                    <a
                      href="https://app.photoroom.com/api-dashboard"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      app.photoroom.com/api-dashboard
                    </a>
                  </Text>
                </BlockStack>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* ── Process Images Card ── */}
        {status?.configured && (
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                  <Icon source={ImageIcon} />
                </Box>
                <BlockStack gap="050">
                  <Text variant="headingMd" as="h2">Process Product Images</Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Remove backgrounds, add white background with drop shadow, and generate clean product images
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <InlineStack gap="300" align="space-between" wrap={false}>
                <Box minWidth="300px">
                  <TextField
                    label=""
                    value={productId}
                    onChange={setProductId}
                    placeholder="Enter Shopify Product ID (e.g. 8234567890123)"
                    autoComplete="off"
                  />
                </Box>
                <Button
                  variant="primary"
                  onClick={handleProcess}
                  loading={processing}
                  disabled={!productId.trim()}
                >
                  {processing ? 'Processing...' : 'Process Images'}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* ── Error Banner ── */}
        {error && (
          <Banner tone="critical" title="Processing Failed" onDismiss={() => setError(null)}>
            <Text as="p">{error}</Text>
          </Banner>
        )}

        {/* ── Results ── */}
        {result && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text variant="headingMd" as="h2">
                    Processing Complete
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    {result.processedCount} of {result.originalCount} images processed successfully
                  </Text>
                </BlockStack>
                <Box
                  background="bg-fill-success-secondary"
                  borderRadius="200"
                  padding="200"
                >
                  <Icon source={CheckCircleIcon} tone="success" />
                </Box>
              </InlineStack>

              <Divider />

              {result.images.length === 0 ? (
                <Box padding="400">
                  <BlockStack gap="200" inlineAlign="center">
                    <Icon source={ImageIcon} tone="subdued" />
                    <Text tone="subdued" as="p">No processed images to display</Text>
                  </BlockStack>
                </Box>
              ) : (
                <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="300">
                  {result.images.map((src, idx) => (
                    <Card key={idx}>
                      <Box padding="200">
                        <img
                          src={src}
                          alt={`Processed image ${idx + 1}`}
                          style={{
                            width: '100%',
                            height: 'auto',
                            maxHeight: '200px',
                            objectFit: 'contain',
                            borderRadius: '4px',
                          }}
                        />
                      </Box>
                    </Card>
                  ))}
                </InlineGrid>
              )}
            </BlockStack>
          </Card>
        )}

        {/* ── Template Manager ── */}
        <TemplateManager initialCategory={initialCategory} />
      </BlockStack>
    </Page>
  );
};

export default ImageProcessor;
