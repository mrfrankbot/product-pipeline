import React, { useState } from 'react';
import {
  Modal,
  Card,
  Checkbox,
  Button,
  Badge,
  Banner,
  InlineStack,
  BlockStack,
  Text,
  TextField,
  Thumbnail,
  Divider,
  InlineGrid,
  EmptyState,
} from '@shopify/polaris';
import { useProductNotes, useSaveProductNotes } from '../hooks/useApi';

interface PipelineReviewModalProps {
  open: boolean;
  onClose: () => void;
  productId: string;
  productTitle: string;
  // Pipeline results
  aiDescription: string | null;        // markdown from pipeline
  currentDescription: string | null;   // current body_html on Shopify
  processedPhotos: Array<{ id: number; originalUrl: string; processedUrl?: string }>;
  currentPhotos: Array<{ id: number; src: string }>;
  ebayCategory: string | null;
  // Callbacks
  onApply: (selections: { description: boolean; photos: boolean; ebayListing: boolean }) => Promise<void>;
  onSaveDraft: () => void;
}

interface Selections {
  description: boolean;
  photos: boolean;
  ebayListing: boolean;
}

export function PipelineReviewModal({
  open,
  onClose,
  productId,
  productTitle,
  aiDescription,
  currentDescription,
  processedPhotos,
  currentPhotos,
  ebayCategory,
  onApply,
  onSaveDraft,
}: PipelineReviewModalProps) {
  const [selections, setSelections] = useState<Selections>({
    description: true,
    photos: true,
    ebayListing: true,
  });
  
  const [isApplying, setIsApplying] = useState(false);

  // Convert markdown to HTML (simplified implementation - should match the one in ShopifyProducts.tsx)
  const markdownToHtml = (markdown: string) => {
    return markdown
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  };

  const handleSelectionChange = (key: keyof Selections, value: boolean) => {
    setSelections(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleApplyAll = async () => {
    setIsApplying(true);
    try {
      await onApply({
        description: true,
        photos: true,
        ebayListing: true,
      });
      onClose();
    } catch (error) {
      console.error('Failed to apply all changes:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplySelected = async () => {
    setIsApplying(true);
    try {
      await onApply(selections);
      onClose();
    } catch (error) {
      console.error('Failed to apply selected changes:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleSaveDraft = () => {
    onSaveDraft();
    onClose();
  };

  const hasProcessedPhotos = processedPhotos.length > 0 && processedPhotos.some(p => p.processedUrl);

  // Product Notes
  const { data: notesData } = useProductNotes(productId);
  const saveNotesMutation = useSaveProductNotes();
  const [localNotes, setLocalNotes] = React.useState('');
  const [notesInit, setNotesInit] = React.useState(false);

  React.useEffect(() => {
    if (notesData?.notes !== undefined && !notesInit) {
      setLocalNotes(notesData.notes);
      setNotesInit(true);
    }
  }, [notesData, notesInit]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pipeline Complete — Review & Approve"
      primaryAction={{
        content: 'Apply All',
        onAction: handleApplyAll,
        loading: isApplying,
      }}
      secondaryActions={[
        {
          content: 'Apply Selected',
          onAction: handleApplySelected,
          loading: isApplying,
        },
        {
          content: 'Save as Draft',
          onAction: handleSaveDraft,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodySm" tone="subdued">
            {productTitle}
          </Text>

          {/* Section 0: Product Notes */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingSm">Product Notes</Text>
                  {localNotes.trim() && <Badge tone="attention">Has Notes</Badge>}
                </InlineStack>
              </InlineStack>
              <TextField
                label=""
                labelHidden
                value={localNotes}
                onChange={setLocalNotes}
                multiline={3}
                placeholder="Add condition notes, blemishes, missing accessories, etc."
                autoComplete="off"
                onBlur={() => {
                  if (localNotes !== (notesData?.notes ?? '')) {
                    saveNotesMutation.mutate({ productId, notes: localNotes });
                  }
                }}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                💡 Notes are included in AI description generation. Save before generating.
              </Text>
            </BlockStack>
          </Card>

          {/* Section 1: AI Description */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Checkbox
                  label="Update Description on Shopify"
                  checked={selections.description}
                  onChange={(value) => handleSelectionChange('description', value)}
                />
                <Badge tone="success">New</Badge>
              </InlineStack>
              
              <Divider />
              
              <InlineGrid columns="1fr 1fr" gap="400">
                {/* New AI Description */}
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm" tone="success">
                      New (AI)
                    </Text>
                    {aiDescription ? (
                      <div
                        style={{
                          border: '1px solid #e1e5e9',
                          borderRadius: '4px',
                          padding: '12px',
                          backgroundColor: '#f9fafb',
                          fontSize: '14px',
                          lineHeight: '1.4',
                        }}
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(aiDescription) }}
                      />
                    ) : (
                      <Text as="p" tone="subdued">No description generated</Text>
                    )}
                  </BlockStack>
                </Card>

                {/* Current Description */}
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      Current
                    </Text>
                    {currentDescription ? (
                      <div
                        style={{
                          border: '1px solid #e1e5e9',
                          borderRadius: '4px',
                          padding: '12px',
                          fontSize: '14px',
                          lineHeight: '1.4',
                        }}
                        dangerouslySetInnerHTML={{ __html: currentDescription }}
                      />
                    ) : (
                      <Text as="p" tone="subdued">No description yet</Text>
                    )}
                  </BlockStack>
                </Card>
              </InlineGrid>
            </BlockStack>
          </Card>

          {/* Section 2: Photos */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Checkbox
                  label="Apply Processed Photos"
                  checked={selections.photos && hasProcessedPhotos}
                  onChange={(value) => handleSelectionChange('photos', value)}
                  disabled={!hasProcessedPhotos}
                />
                <Badge tone={hasProcessedPhotos ? "success" : undefined}>
                  {`${processedPhotos.filter(p => p.processedUrl).length} photos processed`}
                </Badge>
              </InlineStack>
              
              <Divider />
              
              {hasProcessedPhotos ? (
                <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="200">
                  {processedPhotos.map((photo, index) => (
                    <Card key={photo.id}>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          Photo {index + 1}
                        </Text>
                        <InlineStack gap="200" align="center">
                          <BlockStack gap="100" align="center">
                            <Text as="p" variant="bodyXs">Before</Text>
                            <Thumbnail
                              source={photo.originalUrl}
                              alt={`Original photo ${index + 1}`}
                              size="small"
                            />
                          </BlockStack>
                          <Text as="p" variant="bodySm" tone="subdued">→</Text>
                          <BlockStack gap="100" align="center">
                            <Text as="p" variant="bodyXs" tone="success">After</Text>
                            <Thumbnail
                              source={photo.processedUrl || photo.originalUrl}
                              alt={`Processed photo ${index + 1}`}
                              size="small"
                            />
                          </BlockStack>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </InlineGrid>
              ) : (
                <EmptyState
                  heading="No photos processed"
                  image=""
                >
                  <Text as="p" tone="subdued">
                    Photos will be processed if PhotoRoom API key is configured
                  </Text>
                </EmptyState>
              )}
            </BlockStack>
          </Card>

          {/* Section 3: eBay Listing */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Checkbox
                  label="Create eBay Draft Listing"
                  checked={selections.ebayListing}
                  onChange={(value) => handleSelectionChange('ebayListing', value)}
                />
                <Badge tone="info">Draft</Badge>
              </InlineStack>
              
              <Divider />
              
              <BlockStack gap="200">
                {ebayCategory && (
                  <Text as="p">
                    <Text as="span" fontWeight="medium">Category:</Text> {ebayCategory}
                  </Text>
                )}
                <Text as="p" variant="bodySm" tone="subdued">
                  Uses the description and photos selected above
                </Text>
                <Banner tone="info" title="Draft Listing">
                  This creates a draft on eBay and does NOT go live automatically.
                </Banner>
              </BlockStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}