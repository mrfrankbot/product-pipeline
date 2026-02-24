/**
 * DraggablePhotoGrid
 *
 * Drag-and-drop sortable photo grid for the Review Queue draft photos.
 * Features:
 *  • Reorder photos by dragging (auto-saves on drop)
 *  • First photo = hero image (badged)
 *  • Per-photo checkboxes + "Select All" toggle
 *  • Floating bulk action bar: Rotate 90/180/270° and Scale 50–150%
 *  • ProgressBar during bulk processing
 *  • Toast banner on successful save
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Banner,
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  InlineStack,
  ProgressBar,
  Text,
  BlockStack,
  Box,
} from '@shopify/polaris';

// ── Types ───────────────────────────────────────────────────────────────

export interface DraggablePhotoGridProps {
  /** Ordered array of image URLs / data URLs */
  images: string[];
  draftId: number;
  /** Only show edit controls when the draft is still pending */
  isPending: boolean;
  /**
   * Called whenever photos are reordered OR after a bulk transform.
   * Parent is responsible for persisting the new order to the server.
   */
  onReorder: (newImages: string[]) => Promise<void>;
  /** Opens the single-photo ProductPhotoEditor */
  onEditPhoto: (index: number) => void;
  /** Opens the fullscreen lightbox */
  onLightbox: (src: string) => void;
}

interface BulkProgress {
  current: number;
  total: number;
  errors: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Render an image onto a 4000×4000 canvas with the given rotation and scale,
 * then export as a transparent-background PNG blob (PhotoRoom will add the
 * white bg + shadow in the reprocess-edited endpoint).
 */
async function transformImageToBlob(
  imageUrl: string,
  rotationDeg: number,
  scale: number,
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Failed to load image: ${imageUrl.slice(0, 60)}`));
    el.src = imageUrl;
  });

  const SIZE = 4000;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Transparent background — PhotoRoom adds white bg
  ctx.clearRect(0, 0, SIZE, SIZE);

  const aspect = img.width / img.height;
  let drawW: number;
  let drawH: number;
  if (aspect > 1) {
    drawW = SIZE * 0.8;
    drawH = drawW / aspect;
  } else {
    drawH = SIZE * 0.8;
    drawW = drawH * aspect;
  }

  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/png',
    );
  });
}

/**
 * POST the transformed blob to /api/images/reprocess-edited (PhotoRoom)
 * and return the resulting data URL.
 */
async function reprocessEditedImage(blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append('image', blob, `bulk-edit-${Date.now()}.png`);
  const res = await fetch('/api/images/reprocess-edited', { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error || `Reprocess failed (${res.status})`);
  }
  const data = await res.json() as { dataUrl: string };
  return data.dataUrl;
}

// ── SortablePhoto ───────────────────────────────────────────────────────

interface SortablePhotoProps {
  id: string;
  index: number;
  url: string;
  isFirst: boolean;
  isSelected: boolean;
  isPending: boolean;
  disabled: boolean;
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
  onLightbox: (src: string) => void;
}

const SortablePhoto: React.FC<SortablePhotoProps> = ({
  id,
  index,
  url,
  isFirst,
  isSelected,
  isPending,
  disabled,
  onSelect,
  onEdit,
  onLightbox,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const itemStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 50 : 1,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={itemStyle}>
      <div
        style={{
          position: 'relative',
          borderRadius: '8px',
          overflow: 'hidden',
          border: isSelected ? '3px solid #2563eb' : '2px solid #e3e5e7',
          aspectRatio: '1',
          background: '#f3f4f6',
        }}
      >
        {/* Drag handle — covers image area (buttons sit above via z-index) */}
        {isPending && !disabled && (
          <div
            {...attributes}
            {...listeners}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
            title="Drag to reorder"
          />
        )}

        <img
          src={url}
          alt={`Draft photo ${index + 1}`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
          draggable={false}
        />

        {/* Hero badge */}
        {isFirst && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              zIndex: 10,
              background: 'rgba(0, 0, 0, 0.75)',
              color: '#fbbf24',
              borderRadius: '4px',
              padding: '2px 7px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              pointerEvents: 'none',
            }}
          >
            ★ HERO
          </div>
        )}

        {/* Checkbox — top-right, above drag overlay */}
        {isPending && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              zIndex: 20,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(index);
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(index)}
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: '#2563eb',
              }}
              title="Select photo"
            />
          </div>
        )}

        {/* Zoom button — bottom-left */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLightbox(url);
          }}
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            zIndex: 20,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            cursor: 'pointer',
          }}
          title="View full size"
        >
          🔍
        </button>

        {/* Edit button — bottom-right */}
        {isPending && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(index);
            }}
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              zIndex: 20,
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '3px 9px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Edit photo rotation / scale"
          >
            ✏️ Edit
          </button>
        )}

        {/* Position badge — bottom center, only if not first (hero already labeled) */}
        {!isFirst && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              background: 'rgba(0,0,0,0.4)',
              color: '#fff',
              borderRadius: '4px',
              padding: '1px 6px',
              fontSize: '11px',
              pointerEvents: 'none',
            }}
          >
            {index + 1}
          </div>
        )}
      </div>
    </div>
  );
};

// ── DraggablePhotoGrid ──────────────────────────────────────────────────

const DraggablePhotoGrid: React.FC<DraggablePhotoGridProps> = ({
  images,
  draftId: _draftId,
  isPending,
  onReorder,
  onEditPhoto,
  onLightbox,
}) => {
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [saveBanner, setSaveBanner] = useState<{ msg: string; tone: 'success' | 'critical' } | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sensors ────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 6px movement before activating drag — prevents accidental
      // drags when clicking the edit/zoom buttons
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ── Helpers ────────────────────────────────────────────────────────

  const flashBanner = useCallback((msg: string, tone: 'success' | 'critical' = 'success') => {
    setSaveBanner({ msg, tone });
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setSaveBanner(null), 4000);
  }, []);

  // ── Drag end ───────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIdx = images.indexOf(active.id as string);
      const newIdx = images.indexOf(over.id as string);
      if (oldIdx === -1 || newIdx === -1) return;

      const reordered = arrayMove(images, oldIdx, newIdx);
      try {
        await onReorder(reordered);
        const heroName = reordered[0].split('/').pop()?.split('?')[0] ?? 'Photo 1';
        flashBanner(`Order saved — "${heroName}" is now the hero image`);
      } catch {
        flashBanner('Failed to save new order', 'critical');
      }
    },
    [images, onReorder, flashBanner],
  );

  // ── Selection ──────────────────────────────────────────────────────

  const toggleSelectAll = useCallback(() => {
    setSelectedIndexes((prev) =>
      prev.size === images.length ? new Set() : new Set(images.map((_, i) => i)),
    );
  }, [images]);

  const toggleSelect = useCallback((index: number) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // ── Bulk transform ─────────────────────────────────────────────────

  const handleBulkTransform = useCallback(
    async (rotationDeg: number, scale: number) => {
      if (selectedIndexes.size === 0 || bulkProgress !== null) return;

      const indexes = Array.from(selectedIndexes).sort((a, b) => a - b);
      const total = indexes.length;
      const errors: string[] = [];

      setBulkProgress({ current: 0, total, errors });

      const updatedImages = [...images];

      for (let i = 0; i < indexes.length; i++) {
        const idx = indexes[i];
        try {
          const blob = await transformImageToBlob(images[idx], rotationDeg, scale);
          const dataUrl = await reprocessEditedImage(blob);
          updatedImages[idx] = dataUrl;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Photo ${idx + 1}: ${msg}`);
        }
        setBulkProgress({ current: i + 1, total, errors: [...errors] });
      }

      // Persist to draft
      try {
        await onReorder(updatedImages);
        const opLabel =
          rotationDeg !== 0 ? `Rotated ${rotationDeg}°` : `Scaled to ${Math.round(scale * 100)}%`;
        flashBanner(
          errors.length > 0
            ? `${opLabel} — ${total - errors.length}/${total} succeeded (${errors.length} error${errors.length !== 1 ? 's' : ''})`
            : `${opLabel} ${total} photo${total !== 1 ? 's' : ''} — saved`,
          errors.length > 0 ? 'critical' : 'success',
        );
      } catch {
        flashBanner('Bulk edit processed but failed to save', 'critical');
      }

      setBulkProgress(null);
      setSelectedIndexes(new Set());
    },
    [selectedIndexes, bulkProgress, images, onReorder, flashBanner],
  );

  // ── Derived state ──────────────────────────────────────────────────

  const isProcessing = bulkProgress !== null;
  const allSelected = images.length > 0 && selectedIndexes.size === images.length;
  const someSelected = selectedIndexes.size > 0;
  const selectAllChecked: boolean | 'indeterminate' = allSelected
    ? true
    : someSelected
    ? 'indeterminate'
    : false;

  // ── Render ─────────────────────────────────────────────────────────

  if (images.length === 0) {
    return null;
  }

  return (
    <BlockStack gap="300">
      {/* ── Header row ───────────────────────────────────────────── */}
      {isPending && (
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Checkbox
              label={allSelected ? 'Deselect All' : 'Select All'}
              checked={selectAllChecked}
              onChange={toggleSelectAll}
              disabled={isProcessing}
            />
            {someSelected && (
              <Badge tone="info">
                {`${selectedIndexes.size} selected`}
              </Badge>
            )}
          </InlineStack>
          <Text variant="bodySm" as="span" tone="subdued">
            Drag to reorder · first = hero
          </Text>
        </InlineStack>
      )}

      {/* ── Save / error banner ───────────────────────────────────── */}
      {saveBanner && (
        <Banner tone={saveBanner.tone} onDismiss={() => setSaveBanner(null)}>
          <p>{saveBanner.msg}</p>
        </Banner>
      )}

      {/* ── Bulk progress bar ─────────────────────────────────────── */}
      {isProcessing && bulkProgress && (
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" as="span">
                Processing {bulkProgress.current} / {bulkProgress.total} photos…
              </Text>
              <Text variant="bodySm" tone="subdued" as="span">
                {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
              </Text>
            </InlineStack>
            <ProgressBar
              progress={
                bulkProgress.total > 0
                  ? Math.round((bulkProgress.current / bulkProgress.total) * 100)
                  : 0
              }
              size="small"
            />
            {bulkProgress.errors.length > 0 && (
              <Text variant="bodySm" tone="critical" as="p">
                ⚠ {bulkProgress.errors[bulkProgress.errors.length - 1]}
              </Text>
            )}
          </BlockStack>
        </Box>
      )}

      {/* ── Floating bulk action bar ──────────────────────────────── */}
      {someSelected && isPending && !isProcessing && (
        <Box
          padding="300"
          background="bg-surface-secondary"
          borderRadius="200"
        >
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                {`Bulk Edit — ${selectedIndexes.size} photo${selectedIndexes.size !== 1 ? 's' : ''} selected`}
              </Text>
              <Button
                size="slim"
                variant="plain"
                onClick={() => setSelectedIndexes(new Set())}
              >
                Clear selection
              </Button>
            </InlineStack>

            {/* Rotate row */}
            <InlineStack gap="300" blockAlign="center">
              <Text variant="bodySm" as="span" tone="subdued">
                Rotate:
              </Text>
              <ButtonGroup>
                <Button size="slim" onClick={() => handleBulkTransform(90, 1)}>
                  90°
                </Button>
                <Button size="slim" onClick={() => handleBulkTransform(180, 1)}>
                  180°
                </Button>
                <Button size="slim" onClick={() => handleBulkTransform(270, 1)}>
                  270°
                </Button>
              </ButtonGroup>
            </InlineStack>

            {/* Scale row */}
            <InlineStack gap="300" blockAlign="center">
              <Text variant="bodySm" as="span" tone="subdued">
                Scale:
              </Text>
              <ButtonGroup>
                <Button size="slim" onClick={() => handleBulkTransform(0, 0.5)}>
                  50%
                </Button>
                <Button size="slim" onClick={() => handleBulkTransform(0, 0.75)}>
                  75%
                </Button>
                <Button size="slim" onClick={() => handleBulkTransform(0, 1.0)}>
                  100%
                </Button>
                <Button size="slim" onClick={() => handleBulkTransform(0, 1.25)}>
                  125%
                </Button>
                <Button size="slim" onClick={() => handleBulkTransform(0, 1.5)}>
                  150%
                </Button>
              </ButtonGroup>
            </InlineStack>
          </BlockStack>
        </Box>
      )}

      {/* ── Sortable photo grid ───────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={images} strategy={rectSortingStrategy}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '12px',
            }}
          >
            {images.map((url, i) => (
              <SortablePhoto
                key={url}
                id={url}
                index={i}
                url={url}
                isFirst={i === 0}
                isSelected={selectedIndexes.has(i)}
                isPending={isPending}
                disabled={isProcessing || !isPending}
                onSelect={toggleSelect}
                onEdit={onEditPhoto}
                onLightbox={onLightbox}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </BlockStack>
  );
};

export default DraggablePhotoGrid;
