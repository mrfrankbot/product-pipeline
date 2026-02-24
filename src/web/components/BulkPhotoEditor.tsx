/**
 * BulkPhotoEditor — fullscreen modal for batch resize/rotate with live preview.
 *
 * Uses a portal to render outside the normal DOM tree, ensuring proper
 * z-index and centering regardless of parent layout.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const CANVAS_SIZE = 4000;
const PREVIEW_SIZE = 280;

interface BulkPhotoEditorProps {
  selectedIndices: number[];
  allImageUrls: string[];
  draftId?: number;
  onSave: (updatedImages: string[]) => void;
  onCancel: () => void;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

function renderToCanvas(
  img: HTMLImageElement,
  scale: number,
  rotation: number,
  size: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Checkerboard for preview
  if (size <= PREVIEW_SIZE * 2) {
    const sq = 12;
    for (let y = 0; y < size; y += sq) {
      for (let x = 0; x < size; x += sq) {
        ctx.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#f5f5f5' : '#eaeaea';
        ctx.fillRect(x, y, sq, sq);
      }
    }
  } else {
    ctx.clearRect(0, 0, size, size);
  }

  const imgAspect = img.width / img.height;
  let drawW: number, drawH: number;
  if (imgAspect > 1) { drawW = size * 0.8; drawH = drawW / imgAspect; }
  else { drawH = size * 0.8; drawW = drawH * imgAspect; }

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return canvas;
}

// ── Live preview card ──────────────────────────────────────────────────

const PreviewCard: React.FC<{
  url: string;
  index: number;
  scale: number;
  rotation: number;
}> = ({ url, index, scale, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadImage(url).then((img) => {
      if (cancelled) return;
      imgRef.current = img;
      const preview = renderToCanvas(img, scale, rotation, PREVIEW_SIZE);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        ctx.drawImage(preview, 0, 0);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const preview = renderToCanvas(img, scale, rotation, PREVIEW_SIZE);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      ctx.drawImage(preview, 0, 0);
    }
  }, [scale, rotation]);

  return (
    <div style={{
      borderRadius: '10px',
      overflow: 'hidden',
      border: '2px solid #e3e5e7',
      background: '#f9fafb',
      position: 'relative',
    }}>
      <canvas
        ref={canvasRef}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        style={{ display: 'block', width: '100%', aspectRatio: '1' }}
      />
      <div style={{
        position: 'absolute',
        bottom: '6px',
        left: '6px',
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: '4px',
      }}>
        #{index + 1}
      </div>
    </div>
  );
};

// ── Main modal (portaled to document.body) ─────────────────────────────

const BulkPhotoEditor: React.FC<BulkPhotoEditorProps> = ({
  selectedIndices,
  allImageUrls,
  draftId,
  onSave,
  onCancel,
}) => {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !processing) onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, processing]);

  const handleApply = useCallback(async () => {
    setProcessing(true);
    setError(null);
    setProgress(0);

    try {
      const updatedImages = [...allImageUrls];

      for (let i = 0; i < selectedIndices.length; i++) {
        const idx = selectedIndices[i];
        const img = await loadImage(allImageUrls[idx]);
        const canvas = renderToCanvas(img, scale, rotation, CANVAS_SIZE);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
        });

        const formData = new FormData();
        formData.append('image', blob, `bulk-${draftId}-${idx}-${Date.now()}.png`);
        const res = await fetch('/api/images/reprocess-edited', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: 'Reprocess failed' }));
          throw new Error(d.error || `Failed on photo ${idx + 1}`);
        }

        const data = await res.json();
        updatedImages[idx] = data.dataUrl;
        setProgress(i + 1);
      }

      if (draftId) {
        const updateRes = await fetch(`/api/drafts/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: updatedImages }),
        });
        if (!updateRes.ok) throw new Error('Failed to update draft');
      }

      onSave(updatedImages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk edit failed');
    } finally {
      setProcessing(false);
    }
  }, [selectedIndices, allImageUrls, scale, rotation, draftId, onSave]);

  const noChange = scale === 1 && rotation === 0;

  const presetScales = [
    { label: '60%', value: 0.6 },
    { label: '75%', value: 0.75 },
    { label: '85%', value: 0.85 },
    { label: '100%', value: 1 },
    { label: '115%', value: 1.15 },
    { label: '130%', value: 1.3 },
  ];

  const modal = (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !processing) onCancel(); }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483646,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '880px',
          height: 'min(85vh, 720px)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        }}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div style={{
          padding: '18px 24px 14px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>
              Bulk Photo Edit
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#888' }}>
              {selectedIndices.length} photo{selectedIndices.length !== 1 ? 's' : ''} — drag slider to preview changes live
            </p>
          </div>
          <button
            onClick={() => !processing && onCancel()}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              color: '#999',
              cursor: processing ? 'not-allowed' : 'pointer',
              lineHeight: 1,
              padding: '4px 8px',
              borderRadius: '6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Controls ───────────────────────────────────── */}
        <div style={{
          padding: '14px 24px 16px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fafbfc',
          flexShrink: 0,
        }}>
          {/* Size */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#333' }}>Size</span>
              <span style={{
                fontSize: '15px',
                fontWeight: 700,
                color: scale === 1 ? '#999' : '#0064d3',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.round(scale * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.4"
              max="1.5"
              step="0.01"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              disabled={processing}
              style={{ width: '100%', accentColor: '#0064d3' }}
            />
            <div style={{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
              {presetScales.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setScale(value)}
                  disabled={processing}
                  style={{
                    background: Math.abs(scale - value) < 0.01 ? '#0064d3' : '#fff',
                    color: Math.abs(scale - value) < 0.01 ? '#fff' : '#555',
                    border: `1px solid ${Math.abs(scale - value) < 0.01 ? '#0064d3' : '#ddd'}`,
                    borderRadius: '6px',
                    padding: '3px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Rotation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#333', marginRight: '2px' }}>
              Rotate{rotation !== 0 ? ` (${rotation}°)` : ''}
            </span>
            {[
              { label: '↺90', deg: -90 },
              { label: '↺15', deg: -15 },
              { label: '↺5', deg: -5 },
              { label: '↻5', deg: 5 },
              { label: '↻15', deg: 15 },
              { label: '↻90', deg: 90 },
            ].map(({ label, deg }) => (
              <button
                key={deg}
                onClick={() => setRotation((r) => r + deg)}
                disabled={processing}
                style={{
                  background: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: '#555',
                }}
              >
                {label}
              </button>
            ))}
            {rotation !== 0 && (
              <button
                onClick={() => setRotation(0)}
                style={{
                  background: '#fff',
                  border: '1px solid #e0c0c0',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: '#c00',
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* ── Preview grid (scrollable) ──────────────────── */}
        <div style={{
          flex: '1 1 0',
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px 24px',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '12px',
          }}>
            {selectedIndices.map((idx) => (
              <PreviewCard
                key={idx}
                url={allImageUrls[idx]}
                index={idx}
                scale={scale}
                rotation={rotation}
              />
            ))}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────── */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid #eee',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fafbfc',
          flexShrink: 0,
          borderRadius: '0 0 16px 16px',
        }}>
          <div style={{ minHeight: '24px' }}>
            {error && <span style={{ color: '#c00', fontSize: '13px' }}>{error}</span>}
            {processing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '140px',
                  height: '6px',
                  background: '#e0e0e0',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${(progress / selectedIndices.length) * 100}%`,
                    height: '100%',
                    background: '#0064d3',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ fontSize: '13px', color: '#666' }}>
                  {progress}/{selectedIndices.length}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => !processing && onCancel()}
              disabled={processing}
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '8px 20px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: processing ? 'not-allowed' : 'pointer',
                color: '#555',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={processing || noChange}
              style={{
                background: (noChange || processing) ? '#ccc' : '#0064d3',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 24px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: (noChange || processing) ? 'not-allowed' : 'pointer',
              }}
            >
              {processing
                ? 'Processing...'
                : `Apply to ${selectedIndices.length} Photo${selectedIndices.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default BulkPhotoEditor;
