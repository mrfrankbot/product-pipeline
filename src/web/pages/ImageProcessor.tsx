import React, { useCallback, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';

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
      <Page title="Image Processor">
        <Card>
          <InlineStack align="center">
            <Spinner size="small" />
            <Text as="span" variant="bodyMd">
              Checking PhotoRoom status…
            </Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Image Processor" subtitle="PhotoRoom background removal &amp; product image processing">
      <BlockStack gap="400">
        {/* Status card */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              PhotoRoom Integration
            </Text>

            {status?.configured ? (
              <Banner tone="success">
                <Text as="span" variant="bodyMd">
                  PhotoRoom API is configured and ready to use.
                </Text>
              </Banner>
            ) : (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="span" variant="bodyMd">
                    PhotoRoom API is not configured. Set the{' '}
                    <code>PHOTOROOM_API_KEY</code> environment variable to
                    enable automatic image processing.
                  </Text>
                  <Text as="span" variant="bodySm">
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

        {/* Process images card */}
        {status?.configured && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Process Product Images
              </Text>
              <Text as="p" variant="bodyMd">
                Enter a Shopify product ID to remove backgrounds, add a white
                background with drop shadow, and generate clean product images.
              </Text>

              <TextField
                label="Shopify Product ID"
                value={productId}
                onChange={setProductId}
                placeholder="e.g. 8234567890123"
                autoComplete="off"
              />

              <InlineStack align="start">
                <Button
                  variant="primary"
                  onClick={handleProcess}
                  loading={processing}
                  disabled={!productId.trim()}
                >
                  Process Images
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Error banner */}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <Text as="span" variant="bodyMd">
              {error}
            </Text>
          </Banner>
        )}

        {/* Results */}
        {result && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Processed Images ({result.processedCount}/{result.originalCount})
              </Text>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {result.images.map((src, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      padding: '8px',
                      background: '#f9f9f9',
                    }}
                  >
                    <img
                      src={src}
                      alt={`Processed ${idx + 1}`}
                      style={{
                        maxWidth: '240px',
                        maxHeight: '240px',
                        objectFit: 'contain',
                      }}
                    />
                  </div>
                ))}
              </div>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
};

export default ImageProcessor;
