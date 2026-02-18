import React, { useState, useCallback } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Modal,
  Text,
  Thumbnail,
  ButtonGroup,
} from '@shopify/polaris';
import { X, ZoomIn, Pencil } from 'lucide-react';

export interface ActivePhoto {
  id: number;
  position: number;
  src: string;
  alt: string | null;
}

interface ActivePhotosGalleryProps {
  photos: ActivePhoto[];
  loading?: boolean;
  onDeleteSingle: (imageId: number) => void;
  onDeleteBulk: (imageIds: number[]) => void;
  onEditPhotos: (imageIds: number[]) => void;
  onSelectionChange?: (selectedIds: number[]) => void;
  onImageClick?: (photo: ActivePhoto, index: number) => void;
  onEditPhoto?: (photo: ActivePhoto, index: number) => void;
}

const PLACEHOLDER_IMG =
  'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';

const ActivePhotosGallery: React.FC<ActivePhotosGalleryProps> = ({
  photos,
  loading = false,
  onDeleteSingle,
  onDeleteBulk,
  onEditPhotos,
  onSelectionChange,
  onImageClick,
  onEditPhoto,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // Sync selection changes to parent
  const updateSelection = useCallback((newIds: Set<number>) => {
    setSelectedIds(newIds);
    onSelectionChange?.(Array.from(newIds));
  }, [onSelectionChange]);
  const [deleteModalActive, setDeleteModalActive] = useState(false);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ photo: ActivePhoto; index: number } | null>(null);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === photos.length) {
      updateSelection(new Set());
    } else {
      updateSelection(new Set(photos.map(p => p.id)));
    }
  }, [photos, selectedIds.size, updateSelection]);

  const handleSelectPhoto = useCallback((photoId: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(photoId)) {
      newSet.delete(photoId);
    } else {
      newSet.add(photoId);
    }
    updateSelection(newSet);
  }, [selectedIds, updateSelection]);

  const handleDeleteSingle = useCallback((imageId: number) => {
    setDeletingIds([imageId]);
    setDeleteModalActive(true);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    setDeletingIds(Array.from(selectedIds));
    setDeleteModalActive(true);
  }, [selectedIds]);

  const confirmDelete = useCallback(() => {
    if (deletingIds.length === 1) {
      onDeleteSingle(deletingIds[0]);
    } else {
      onDeleteBulk(deletingIds);
    }
    setDeleteModalActive(false);
    updateSelection(new Set());
    setDeletingIds([]);
  }, [deletingIds, onDeleteSingle, onDeleteBulk]);

  const handleEditPhotos = useCallback(() => {
    if (selectedIds.size === 0) {
      // If nothing selected, edit all photos
      onEditPhotos(photos.map(p => p.id));
    } else {
      onEditPhotos(Array.from(selectedIds));
    }
  }, [selectedIds, photos, onEditPhotos]);

  const openLightbox = useCallback((photo: ActivePhoto, index: number) => {
    setLightboxPhoto({ photo, index });
    onImageClick?.(photo, index);
  }, [onImageClick]);

  const closeLightbox = useCallback(() => {
    setLightboxPhoto(null);
  }, []);

  const navigateLightbox = useCallback((direction: 'prev' | 'next') => {
    if (!lightboxPhoto) return;
    
    const currentIndex = lightboxPhoto.index;
    let newIndex: number;
    
    if (direction === 'prev') {
      newIndex = currentIndex === 0 ? photos.length - 1 : currentIndex - 1;
    } else {
      newIndex = currentIndex === photos.length - 1 ? 0 : currentIndex + 1;
    }
    
    setLightboxPhoto({ photo: photos[newIndex], index: newIndex });
  }, [lightboxPhoto, photos]);

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <InlineStack align="center">
            <Text tone="subdued" as="p">Loading photos...</Text>
          </InlineStack>
        </Box>
      </Card>
    );
  }

  const allSelected = selectedIds.size === photos.length && photos.length > 0;
  const someSelected = selectedIds.size > 0;
  const selectAllChecked = allSelected ? true : someSelected ? 'indeterminate' as const : false;

  return (
    <>
      <Card>
        <BlockStack gap="400">
          {/* Header */}
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Photos on Shopify ({photos.length})
                </Text>
                {photos.length > 0 && (
                  <Checkbox
                    label="Select All"
                    checked={selectAllChecked}
                    onChange={handleSelectAll}
                  />
                )}
              </InlineStack>
              <Text variant="bodySm" tone="subdued" as="p">
                These are the images currently live on your Shopify product
              </Text>
            </BlockStack>
          </InlineStack>

          {/* Bulk Action Bar */}
          {someSelected && (
            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="bodySm" as="span">
                  {selectedIds.size} photo{selectedIds.size !== 1 ? 's' : ''} selected
                </Text>
                <ButtonGroup>
                  <Button
                    size="slim"
                    tone="critical"
                    onClick={handleDeleteSelected}
                  >
                    Delete Selected
                  </Button>
                  <Button
                    size="slim"
                    variant="primary"
                    onClick={handleEditPhotos}
                  >
                    Edit with PhotoRoom
                  </Button>
                </ButtonGroup>
              </InlineStack>
            </Box>
          )}

          {/* Photos Grid */}
          {photos.length === 0 ? (
            <Box padding="800">
              <BlockStack gap="200" inlineAlign="center">
                <Text tone="subdued" as="p" alignment="center">
                  No photos found on this Shopify product.
                </Text>
                <Text tone="subdued" as="p" alignment="center" variant="bodySm">
                  Add photos in Shopify admin, then refresh this page.
                </Text>
              </BlockStack>
            </Box>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '12px',
              }}
            >
              {photos.map((photo, index) => (
                <div key={photo.id} style={{ position: 'relative' }}>
                  <div
                    style={{
                      border: selectedIds.has(photo.id) ? '2px solid #2563eb' : '2px solid transparent',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <div onClick={() => openLightbox(photo, index)} style={{ cursor: 'pointer' }}>
                      <Thumbnail
                        size="large"
                        source={photo.src || PLACEHOLDER_IMG}
                        alt={photo.alt || `Product image ${photo.position}`}
                      />
                    </div>
                    
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSingle(photo.id);
                      }}
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        border: 'none',
                        borderRadius: '50%',
                        padding: '4px',
                        cursor: 'pointer',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Delete this photo"
                    >
                      <X size={16} />
                    </button>

                    {/* Checkbox */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '6px',
                        left: '6px',
                      }}
                    >
                      <Checkbox
                        label=""
                        checked={selectedIds.has(photo.id)}
                        onChange={() => handleSelectPhoto(photo.id)}
                      />
                    </div>

                    {/* Edit button */}
                    {onEditPhoto && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditPhoto(photo, index);
                        }}
                        style={{
                          position: 'absolute',
                          bottom: '6px',
                          left: '6px',
                          background: 'rgba(0, 0, 0, 0.7)',
                          border: 'none',
                          borderRadius: '50%',
                          padding: '4px',
                          cursor: 'pointer',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Edit photo (rotate/scale/reposition)"
                      >
                        <Pencil size={16} />
                      </button>
                    )}

                    {/* Zoom button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openLightbox(photo, index);
                      }}
                      style={{
                        position: 'absolute',
                        bottom: '6px',
                        right: '6px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        border: 'none',
                        borderRadius: '50%',
                        padding: '4px',
                        cursor: 'pointer',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="View full size"
                    >
                      <ZoomIn size={16} />
                    </button>
                  </div>

                  {/* Position indicator */}
                  <Box paddingBlockStart="100">
                    <Text variant="bodySm" tone="subdued" as="p" alignment="center">
                      Position {photo.position}
                    </Text>
                  </Box>
                </div>
              ))}
            </div>
          )}
        </BlockStack>
      </Card>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalActive}
        onClose={() => setDeleteModalActive(false)}
        title={`Delete ${deletingIds.length} photo${deletingIds.length !== 1 ? 's' : ''}?`}
        primaryAction={{
          content: 'Delete',
          destructive: true,
          onAction: confirmDelete,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setDeleteModalActive(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Delete {deletingIds.length} photo{deletingIds.length !== 1 ? 's' : ''} from Shopify? 
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            backgroundColor: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '50%',
              padding: '8px',
              cursor: 'pointer',
              color: '#fff',
            }}
          >
            <X size={24} />
          </button>

          {/* Previous button */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox('prev');
              }}
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                padding: '12px',
                cursor: 'pointer',
                color: '#fff',
              }}
            >
              ←
            </button>
          )}

          {/* Image */}
          <img
            src={lightboxPhoto.photo.src}
            alt={lightboxPhoto.photo.alt || 'Product image'}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '8px',
            }}
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next button */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox('next');
              }}
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                padding: '12px',
                cursor: 'pointer',
                color: '#fff',
              }}
            >
              →
            </button>
          )}

          {/* Counter */}
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#fff',
              fontSize: '14px',
              opacity: 0.8,
            }}
          >
            {lightboxPhoto.index + 1} / {photos.length}
          </div>
        </div>
      )}
    </>
  );
};

export default ActivePhotosGallery;