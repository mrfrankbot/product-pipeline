import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  BlockStack,
  InlineStack,
  Button,
  RangeSlider,
  Text,
  Spinner,
  Banner,
} from '@shopify/polaris';
import { RotateCw, Move, ZoomIn } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────

interface ProductPhotoEditorProps {
  /** The source image URL (bg-removed transparent PNG) */
  imageUrl: string;
  /** Draft ID for saving back (not needed when using onCustomSave) */
  draftId?: number;
  /** Index of this image in the draft's image array */
  imageIndex: number;
  /** All current draft image URLs */
  allDraftImages: string[];
  /** Called after successful save with the updated images array */
  onSave: (updatedImages: string[]) => void;
  /** Called to close the editor */
  onClose: () => void;
  /** Whether the modal is open */
  open: boolean;
  /** Optional custom save handler — receives the rendered blob. If provided, skips default draft save logic. */
  onCustomSave?: (blob: Blob) => Promise<void>;
}

interface Transform {
  rotation: number;   // degrees, -180 to 180
  scale: number;      // 0.5 to 1.5
  offsetX: number;    // px offset from center
  offsetY: number;    // px offset from center
}

const DEFAULT_TRANSFORM: Transform = {
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

// Canvas output size (square, matching typical product photo dimensions)
const CANVAS_SIZE = 4000;
const WATERMARK_FONT_SIZE = 24;
const WATERMARK_PADDING = 20;

// ── Component ──────────────────────────────────────────────────────────

const ProductPhotoEditor: React.FC<ProductPhotoEditorProps> = ({
  imageUrl,
  draftId,
  imageIndex,
  allDraftImages,
  onSave,
  onClose,
  open,
  onCustomSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [productImg, setProductImg] = useState<HTMLImageElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ ...DEFAULT_TRANSFORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Drag state
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // ── Load product image ─────────────────────────────────────────────

  useEffect(() => {
    if (!open || !imageUrl) return;
    setLoading(true);
    setError(null);

    // Proxy GCS URLs through our backend to avoid CORS issues
    // Add clean=true to try loading the no-watermark variant first
    const proxyUrl = (u: string, clean = false) => {
      if (!u.includes('storage.googleapis.com')) return u;
      const base = `/api/images/proxy?url=${encodeURIComponent(u)}`;
      return clean ? `${base}&clean=true` : base;
    };

    const isGCS = imageUrl.includes('storage.googleapis.com');

    const loadImage = (url: string, isFallback = false) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setProductImg(img);
        setLoading(false);
      };
      img.onerror = () => {
        if (!isFallback) {
          // Clean version failed, fall back to watermarked original
          loadImage(isGCS ? proxyUrl(imageUrl) : imageUrl, true);
        } else {
          setError('Failed to load image. The image may not support cross-origin access.');
          setLoading(false);
        }
      };
      img.src = url;
    };

    // Try clean (no watermark) first for GCS images, fall back to original
    loadImage(isGCS ? proxyUrl(imageUrl, true) : imageUrl);
  }, [imageUrl, open]);

  // Reset transform when image changes
  useEffect(() => {
    setTransform({ ...DEFAULT_TRANSFORM });
  }, [imageUrl]);

  // ── Render canvas ──────────────────────────────────────────────────

  const renderCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, img: HTMLImageElement, t: Transform) => {
      const { rotation, scale, offsetX, offsetY } = t;

      // Clear + white background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);

      // Draw product image centered with transforms
      ctx.save();
      ctx.translate(size / 2 + offsetX, size / 2 + offsetY);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);

      // Fit image within canvas maintaining aspect ratio
      const imgAspect = img.width / img.height;
      let drawW: number, drawH: number;
      if (imgAspect > 1) {
        drawW = size * 0.85;
        drawH = drawW / imgAspect;
      } else {
        drawH = size * 0.85;
        drawW = drawH * imgAspect;
      }
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      // Watermark overlay
      ctx.save();

      // ©2026 text — bottom-left
      ctx.font = `${WATERMARK_FONT_SIZE}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(180, 180, 180, 0.6)';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText('©2026 ACTUAL IMAGE OF PRODUCT', WATERMARK_PADDING, size - WATERMARK_PADDING);

      // usedcameragear.com — bottom-right
      ctx.textAlign = 'right';
      ctx.fillText('usedcameragear.com', size - WATERMARK_PADDING, size - WATERMARK_PADDING);

      ctx.restore();
    },
    [],
  );

  // Re-render preview whenever transform or image changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !productImg) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Preview at display size
    const displaySize = canvas.width;
    renderCanvas(ctx, displaySize, productImg, transform);
  }, [productImg, transform, renderCanvas]);

  // ── Drag handlers ──────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
      };
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [transform.offsetX, transform.offsetY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging || !dragStart.current || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const displaySize = canvas.clientWidth;
      const canvasSize = canvas.width;
      const scaleFactor = canvasSize / displaySize;

      const dx = (e.clientX - dragStart.current.x) * scaleFactor;
      const dy = (e.clientY - dragStart.current.y) * scaleFactor;
      setTransform((prev) => ({
        ...prev,
        offsetX: dragStart.current!.offsetX + dx,
        offsetY: dragStart.current!.offsetY + dy,
      }));
    },
    [dragging],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
  }, []);

  // ── Save handler ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!productImg) return;
    setSaving(true);
    setError(null);

    try {
      // Render at full resolution
      const offscreen = document.createElement('canvas');
      offscreen.width = CANVAS_SIZE;
      offscreen.height = CANVAS_SIZE;
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      // Scale transform offsets from preview to full size
      const previewSize = canvasRef.current?.width || 600;
      const scaleFactor = CANVAS_SIZE / previewSize;
      const fullTransform: Transform = {
        ...transform,
        offsetX: transform.offsetX * scaleFactor,
        offsetY: transform.offsetY * scaleFactor,
      };

      renderCanvas(ctx, CANVAS_SIZE, productImg, fullTransform);

      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        offscreen.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          'image/png',
        );
      });

      // Custom save flow (e.g., direct Shopify replace)
      if (onCustomSave) {
        await onCustomSave(blob);
        onClose();
        return;
      }

      // Default draft save flow
      const formData = new FormData();
      formData.append('image', blob, `edited-${draftId}-${imageIndex}-${Date.now()}.png`);
      formData.append('draftId', String(draftId));
      formData.append('imageIndex', String(imageIndex));

      const res = await fetch('/api/photos/edit', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      const data = await res.json();
      const newUrl = data.url;

      // Update the draft images array
      const updatedImages = [...allDraftImages];
      updatedImages[imageIndex] = newUrl;

      // Save updated images back to draft
      const updateRes = await fetch(`/api/drafts/${draftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: updatedImages }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update draft with edited image');
      }

      onSave(updatedImages);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [productImg, transform, draftId, imageIndex, allDraftImages, onSave, onClose, renderCanvas]);

  // ── Render ─────────────────────────────────────────────────────────

  const previewSize = 400;

  return (
    <div style={{ position: 'relative', zIndex: 999999 }}>
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Product Photo"
      size="large"
      primaryAction={{
        content: saving ? 'Saving...' : 'Save & Replace',
        onAction: handleSave,
        loading: saving,
        disabled: loading || !productImg,
      }}
      secondaryActions={[
        {
          content: 'Reset',
          onAction: () => setTransform({ ...DEFAULT_TRANSFORM }),
        },
        { content: 'Cancel', onAction: onClose },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem' }}>
              <Spinner size="large" />
              <div style={{ marginTop: '12px' }}>
                <Text as="p" tone="subdued">Loading image...</Text>
              </div>
            </div>
          ) : (
            <>
              {/* Canvas Preview */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  background: '#f3f4f6',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={previewSize}
                  height={previewSize}
                  style={{
                    width: `${previewSize}px`,
                    height: `${previewSize}px`,
                    maxWidth: '100%',
                    cursor: dragging ? 'grabbing' : 'grab',
                    borderRadius: '4px',
                    border: '1px solid #e3e5e7',
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />
              </div>

              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                <Move size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Drag to reposition · Use sliders to rotate and scale
              </Text>

              {/* Controls */}
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <div style={{ width: '20px' }}>
                    <RotateCw size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <RangeSlider
                      label={`Rotation: ${transform.rotation}°`}
                      min={-180}
                      max={180}
                      step={1}
                      value={transform.rotation}
                      onChange={(val: number) =>
                        setTransform((prev) => ({ ...prev, rotation: typeof val === 'number' ? val : Number(val) }))
                      }
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="200" blockAlign="center">
                  <div style={{ width: '20px' }}>
                    <ZoomIn size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <RangeSlider
                      label={`Scale: ${Math.round(transform.scale * 100)}%`}
                      min={50}
                      max={150}
                      step={1}
                      value={Math.round(transform.scale * 100)}
                      onChange={(val: number) =>
                        setTransform((prev) => ({ ...prev, scale: (typeof val === 'number' ? val : Number(val)) / 100 }))
                      }
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
    </div>
  );
};

export default ProductPhotoEditor;
