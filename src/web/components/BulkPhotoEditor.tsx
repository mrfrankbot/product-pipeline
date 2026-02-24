/**
 * BulkPhotoEditor — toolbar for batch resize/rotate of selected photos.
 *
 * Renders inline above the photo grid. Processing happens client-side:
 *   1. Load each image onto a 4000×4000 canvas
 *   2. Apply scale + rotation
 *   3. POST the transparent PNG to /api/images/reprocess-edited
 *   4. Collect new data URLs and call onSave with updated image array
 */

import React, { useState, useCallback } from 'react';

const CANVAS_SIZE = 4000;

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
): HTMLCanvasElement {
  const size = CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

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

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

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

  const handleApply = useCallback(async () => {
    setProcessing(true);
    setError(null);
    setProgress(0);

    try {
      const updatedImages = [...allImageUrls];
      const total = selectedIndices.length;

      for (let i = 0; i < total; i++) {
        const idx = selectedIndices[i];
        const url = allImageUrls[idx];

        // Load image
        const img = await loadImage(url);

        // Render with transforms
        const canvas = renderToCanvas(img, scale, rotation);
        const blob = await canvasToBlob(canvas);

        // Send to reprocess endpoint
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

      // Save all updated images to draft
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

  return (
    <div
      style={{
        background: '#f0f4ff',
        border: '1px solid #c4d5f7',
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: '14px' }}>
          Bulk Edit — {selectedIndices.length} photo{selectedIndices.length !== 1 ? 's' : ''} selected
        </strong>
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#666',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {/* Scale slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}>
            Size: {Math.round(scale * 100)}%
          </label>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            style={{ width: '140px' }}
            disabled={processing}
          />
        </div>

        {/* Rotation buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, marginRight: '4px' }}>Rotate:</label>
          {[-90, -15, -5, 5, 15, 90].map((deg) => (
            <button
              key={deg}
              onClick={() => setRotation((r) => r + deg)}
              disabled={processing}
              style={{
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {deg > 0 ? `+${deg}°` : `${deg}°`}
            </button>
          ))}
          {rotation !== 0 && (
            <button
              onClick={() => setRotation(0)}
              disabled={processing}
              style={{
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '12px',
                cursor: 'pointer',
                color: '#c00',
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Apply button */}
        <button
          onClick={handleApply}
          disabled={processing || noChange}
          style={{
            background: noChange ? '#ccc' : '#0064d3',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: noChange ? 'not-allowed' : 'pointer',
            opacity: processing ? 0.7 : 1,
          }}
        >
          {processing
            ? `Processing ${progress}/${selectedIndices.length}...`
            : 'Apply to Selected'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#c00', fontSize: '13px' }}>{error}</div>
      )}
    </div>
  );
};

export default BulkPhotoEditor;
