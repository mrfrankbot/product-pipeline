import React, { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

interface ProductPhotoEditorProps {
  imageUrl: string;
  draftId?: number;
  imageIndex: number;
  allDraftImages: string[];
  onSave: (updatedImages: string[]) => void;
  onClose: () => void;
  open: boolean;
  onCustomSave?: (blob: Blob) => Promise<void>;
}

interface Transform {
  rotation: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_TRANSFORM: Transform = { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 };
const CANVAS_SIZE = 4000;
const WATERMARK_FONT_SIZE = 24;
const WATERMARK_PADDING = 20;
const PREVIEW_SIZE = 380;

// ── Styles ─────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 2147483647, // max 32-bit int — above everything
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.5)',
};

const dialogStyle: React.CSSProperties = {
  position: 'relative',
  background: '#fff',
  borderRadius: '12px',
  width: '90vw',
  maxWidth: '680px',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid #e3e5e7',
};

const bodyStyle: React.CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  padding: '12px 20px',
  borderTop: '1px solid #e3e5e7',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#2c6ecb',
  color: '#fff',
  border: '1px solid #2c6ecb',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

// ── Component ──────────────────────────────────────────────────────────

const ProductPhotoEditor: React.FC<ProductPhotoEditorProps> = ({
  imageUrl, draftId, imageIndex, allDraftImages, onSave, onClose, open, onCustomSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [productImg, setProductImg] = useState<HTMLImageElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ ...DEFAULT_TRANSFORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // ── Load product image ─────────────────────────────────────────────

  useEffect(() => {
    if (!open || !imageUrl) return;
    setLoading(true);
    setError(null);

    // Extract product ID and index from any URL (GCS or Shopify CDN)
    const match = imageUrl.match(/(\d{10,})_(\d+)\.png/);
    const gcsBase = match
      ? `https://storage.googleapis.com/pictureline-product-photos/processed/${match[1]}_${match[2]}`
      : null;

    const proxyGcs = (path: string) =>
      `/api/images/proxy?url=${encodeURIComponent(path)}`;

    const loadImage = (url: string, fallbacks: string[]) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { setProductImg(img); setLoading(false); };
      img.onerror = () => {
        if (fallbacks.length > 0) {
          loadImage(fallbacks[0], fallbacks.slice(1));
        } else {
          setError('Failed to load image.');
          setLoading(false);
        }
      };
      img.src = url;
    };

    // Priority: cutout (transparent) → clean (white bg) → original
    const urls: string[] = [];
    if (gcsBase) {
      urls.push(proxyGcs(`${gcsBase}_cutout.png`));
      urls.push(proxyGcs(`${gcsBase}_clean.png`));
      urls.push(proxyGcs(`${gcsBase}.png`));
    }
    urls.push(imageUrl);
    loadImage(urls[0], urls.slice(1));
  }, [imageUrl, open]);

  useEffect(() => { setTransform({ ...DEFAULT_TRANSFORM }); }, [imageUrl]);

  // ── Render canvas ──────────────────────────────────────────────────

  const renderCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, img: HTMLImageElement, t: Transform) => {
      const { rotation, scale, offsetX, offsetY } = t;

      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);

      // Calculate product dimensions
      const imgAspect = img.width / img.height;
      let drawW: number, drawH: number;
      if (imgAspect > 1) { drawW = size * 0.8; drawH = drawW / imgAspect; }
      else { drawH = size * 0.8; drawW = drawH * imgAspect; }

      // Product image with transforms
      ctx.save();
      ctx.translate(size / 2 + offsetX, size / 2 + offsetY);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      // Fixed ground shadow (stays at bottom, doesn't rotate)
      ctx.save();
      const shadowCenterX = size / 2 + offsetX;
      const shadowY = size / 2 + (drawH * scale) / 2 + size * 0.015;
      const shadowW = drawW * scale * 0.6;
      const shadowH = size * 0.02;
      const grad = ctx.createRadialGradient(shadowCenterX, shadowY, 0, shadowCenterX, shadowY, shadowW);
      grad.addColorStop(0, 'rgba(0,0,0,0.12)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.04)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(shadowCenterX, shadowY, shadowW, shadowH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Fixed watermark overlay
      ctx.save();
      ctx.font = `${WATERMARK_FONT_SIZE}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(180, 180, 180, 0.6)';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText('©2026 ACTUAL IMAGE OF PRODUCT', WATERMARK_PADDING, size - WATERMARK_PADDING);
      ctx.textAlign = 'right';
      ctx.fillText('usedcameragear.com', size - WATERMARK_PADDING, size - WATERMARK_PADDING);
      ctx.restore();
    }, [],
  );

  // Re-render on transform/image change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !productImg) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderCanvas(ctx, canvas.width, productImg, transform);
  }, [productImg, transform, renderCanvas]);

  // ── Drag handlers ──────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, offsetX: transform.offsetX, offsetY: transform.offsetY };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }, [transform.offsetX, transform.offsetY]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStart.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const scaleFactor = canvas.width / canvas.clientWidth;
    const dx = (e.clientX - dragStart.current.x) * scaleFactor;
    const dy = (e.clientY - dragStart.current.y) * scaleFactor;
    setTransform(prev => ({ ...prev, offsetX: dragStart.current!.offsetX + dx, offsetY: dragStart.current!.offsetY + dy }));
  }, [dragging]);

  const handlePointerUp = useCallback(() => { setDragging(false); dragStart.current = null; }, []);

  // ── Save handler ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!productImg) return;
    setSaving(true);
    setError(null);
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = CANVAS_SIZE;
      offscreen.height = CANVAS_SIZE;
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      const previewCanvasSize = canvasRef.current?.width || PREVIEW_SIZE;
      const scaleFactor = CANVAS_SIZE / previewCanvasSize;
      renderCanvas(ctx, CANVAS_SIZE, productImg, {
        ...transform,
        offsetX: transform.offsetX * scaleFactor,
        offsetY: transform.offsetY * scaleFactor,
      });

      const blob = await new Promise<Blob>((resolve, reject) => {
        offscreen.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/png');
      });

      if (onCustomSave) { await onCustomSave(blob); onClose(); return; }

      const formData = new FormData();
      formData.append('image', blob, `edited-${draftId}-${imageIndex}-${Date.now()}.png`);
      formData.append('draftId', String(draftId));
      formData.append('imageIndex', String(imageIndex));
      const res = await fetch('/api/photos/edit', { method: 'POST', body: formData });
      if (!res.ok) { const d = await res.json().catch(() => ({ error: 'Upload failed' })); throw new Error(d.error || `Upload failed (${res.status})`); }
      const data = await res.json();
      const updatedImages = [...allDraftImages];
      updatedImages[imageIndex] = data.url;
      const updateRes = await fetch(`/api/drafts/${draftId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: updatedImages }) });
      if (!updateRes.ok) throw new Error('Failed to update draft');
      onSave(updatedImages);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [productImg, transform, draftId, imageIndex, allDraftImages, onSave, onClose, renderCanvas, onCustomSave]);

  // ── Escape key ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Render ─────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div style={overlayStyle}>
      <div style={backdropStyle} onClick={onClose} />
      <div style={dialogStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Edit Product Photo</h2>
          <button onClick={onClose} style={{ ...btnStyle, border: 'none', fontSize: '18px', padding: '4px 8px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', padding: '8px 12px', color: '#991b1b', fontSize: '13px' }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Loading image...</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', background: '#f3f4f6', borderRadius: '8px', padding: '8px' }}>
                <canvas
                  ref={canvasRef}
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  style={{
                    width: `${PREVIEW_SIZE}px`,
                    height: `${PREVIEW_SIZE}px`,
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

              <div style={{ textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                ↕ Drag to reposition · Use sliders to rotate and scale
              </div>

              {/* Rotation */}
              <div style={sliderRowStyle}>
                <span style={{ fontSize: '13px', width: '95px', flexShrink: 0 }}>Rotation: {transform.rotation}°</span>
                <input
                  type="range" min={-180} max={180} step={1}
                  value={transform.rotation}
                  onChange={e => setTransform(prev => ({ ...prev, rotation: Number(e.target.value) }))}
                  style={{ flex: 1 }}
                />
              </div>

              {/* Scale */}
              <div style={sliderRowStyle}>
                <span style={{ fontSize: '13px', width: '95px', flexShrink: 0 }}>Scale: {Math.round(transform.scale * 100)}%</span>
                <input
                  type="range" min={50} max={200} step={1}
                  value={Math.round(transform.scale * 100)}
                  onChange={e => setTransform(prev => ({ ...prev, scale: Number(e.target.value) / 100 }))}
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button style={btnStyle} onClick={() => setTransform({ ...DEFAULT_TRANSFORM })}>Reset</button>
          <button style={btnStyle} onClick={onClose}>Cancel</button>
          <button
            style={{ ...btnPrimaryStyle, opacity: (loading || !productImg || saving) ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={loading || !productImg || saving}
          >
            {saving ? 'Saving...' : 'Save & Replace'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductPhotoEditor;
