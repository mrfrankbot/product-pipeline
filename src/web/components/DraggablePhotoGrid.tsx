/**
 * DraggablePhotoGrid
 *
 * A drag-and-drop sortable photo grid for eBay listing prep.
 * Built with @dnd-kit/core + @dnd-kit/sortable.
 *
 * • First photo is the hero / main eBay listing image (shown with MAIN badge).
 * • Photos can be reordered by dragging — touch and mouse both work.
 * • Each card has a × remove button that does NOT interfere with dragging.
 * • Exports `DraggablePhotoGrid` as default so other pages can reuse it.
 */

import React, { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Types ──────────────────────────────────────────────────────────────

export interface DraggablePhotoGridProps {
  /** Ordered list of image URLs */
  imageUrls: string[];
  /** Called with the new URL order after any reorder or removal */
  onChange: (urls: string[]) => void;
  /** Called when user clicks edit on a photo — receives the photo index */
  onEditPhoto?: (index: number) => void;
}

// ── Stable per-photo item ID ───────────────────────────────────────────
// We append the original index so duplicate URLs get unique keys.

function makeId(url: string, index: number) {
  return `${index}::${url}`;
}

function urlFromId(id: string) {
  return id.slice(id.indexOf('::') + 2);
}

// ── Single sortable photo card ─────────────────────────────────────────

interface SortablePhotoProps {
  id: string;
  url: string;
  index: number;
  /** Total photos — used to dim when ghost is active */
  total: number;
  isOverlay?: boolean;
  onRemove: () => void;
  onEdit?: () => void;
}

const SortablePhoto: React.FC<SortablePhotoProps> = ({
  id,
  url,
  index,
  isOverlay = false,
  onRemove,
  onEdit,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const cardStyle: React.CSSProperties = {
    borderRadius: '8px',
    overflow: 'hidden',
    border: `2px solid ${isDragging ? '#0064d3' : '#e3e5e7'}`,
    position: 'relative',
    background: '#f9fafb',
    opacity: isDragging && !isOverlay ? 0.4 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
    boxShadow: isOverlay ? '0 8px 24px rgba(0,0,0,0.18)' : undefined,
    touchAction: 'none',
  };

  return (
    <div ref={setNodeRef} style={cardStyle} {...attributes}>
      {/* Drag handle — the image itself; no pointer events on remove btn */}
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        style={{ cursor: isOverlay ? 'grabbing' : 'grab', display: 'block', userSelect: 'none' }}
        title="Drag to reorder"
      >
        <img
          src={url}
          alt={`Photo ${index + 1}`}
          draggable={false}
          style={{
            width: '100%',
            aspectRatio: '1',
            objectFit: 'cover',
            display: 'block',
            pointerEvents: 'none', // prevent browser native image drag
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = '0.3';
          }}
        />
      </div>

      {/* MAIN badge — first photo only */}
      {index === 0 && (
        <div
          style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            background: '#0064d3',
            color: '#fff',
            fontSize: '10px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '4px',
            pointerEvents: 'none',
          }}
        >
          MAIN
        </div>
      )}

      {/* Drag hint */}
      <div
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          color: 'rgba(255,255,255,0.85)',
          fontSize: '14px',
          lineHeight: 1,
          textShadow: '0 1px 3px rgba(0,0,0,0.7)',
          pointerEvents: 'none',
        }}
      >
        ⠿
      </div>

      {/* Photo number */}
      <div
        style={{
          position: 'absolute',
          bottom: '28px',
          left: '6px',
          color: 'rgba(255,255,255,0.9)',
          fontSize: '11px',
          fontWeight: 600,
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          pointerEvents: 'none',
        }}
      >
        #{index + 1}
      </div>

      {/* Edit button — outside drag listeners */}
      {!isOverlay && onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit photo"
          style={{
            position: 'absolute',
            bottom: '4px',
            left: '4px',
            background: 'rgba(0,100,211,0.85)',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            width: '24px',
            height: '24px',
            cursor: 'pointer',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ✎
        </button>
      )}

      {/* Remove button — outside drag listeners */}
      {!isOverlay && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove photo"
          style={{
            position: 'absolute',
            bottom: '4px',
            right: '4px',
            background: 'rgba(200,0,0,0.80)',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            width: '24px',
            height: '24px',
            cursor: 'pointer',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
};

// ── Main export ────────────────────────────────────────────────────────

const DraggablePhotoGrid: React.FC<DraggablePhotoGridProps> = ({
  imageUrls,
  onChange,
  onEditPhoto,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Stable IDs — append original index so dupes get unique keys
  const items = imageUrls.map((url, i) => makeId(url, i));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance so clicks on the remove button still register
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      onChange(arrayMove(imageUrls, oldIndex, newIndex));
    },
    [items, imageUrls, onChange],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(imageUrls.filter((_, i) => i !== index));
    },
    [imageUrls, onChange],
  );

  if (imageUrls.length === 0) {
    return (
      <div
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: '8px',
          padding: '24px',
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: '14px',
        }}
      >
        No photos available. eBay requires at least one image.
      </div>
    );
  }

  const activeIndex = activeId ? items.indexOf(activeId) : -1;
  const activeUrl = activeIndex >= 0 ? imageUrls[activeIndex] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '12px',
          }}
        >
          {items.map((id, index) => (
            <SortablePhoto
              key={id}
              id={id}
              url={imageUrls[index]}
              index={index}
              total={imageUrls.length}
              onRemove={() => handleRemove(index)}
              onEdit={onEditPhoto ? () => onEditPhoto(index) : undefined}
            />
          ))}
        </div>
      </SortableContext>

      {/* Drag overlay — floats above everything while dragging */}
      <DragOverlay adjustScale={false}>
        {activeUrl !== null ? (
          <SortablePhoto
            id={activeId!}
            url={activeUrl}
            index={activeIndex}
            total={imageUrls.length}
            isOverlay
            onRemove={() => {}} // noop in overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default DraggablePhotoGrid;
