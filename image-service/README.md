# Image Processing Service (PhotoRoom Replacement)

Self-hosted product photography pipeline: background removal → clean backgrounds → padding → shadows → branding overlays.

## Status: ✅ Working

**Server running on port 8100** — tested end-to-end with real product photo.

## Architecture

- **bg_removal.py** — Direct ONNX u2net inference (no rembg dependency, avoids numba/llvmlite build issues on Python 3.13)
- **image_processor.py** — Padding, centering, drop shadow, background color, resize
- **template_renderer.py** — Semi-transparent text bar overlay (branding)
- **server.py** — FastAPI with concurrency controls, request timeouts, metrics, structured logging
- **logger.py** — JSON structured logging with request ID tracking

## Setup

```bash
cd ~/projects/product-pipeline/image-service
python3.13 -m venv .venv
source .venv/bin/activate
pip install onnxruntime fastapi uvicorn pillow python-multipart numpy scipy pooch tqdm psutil
```

The u2net.onnx model (~176MB) auto-downloads to `~/.u2net/` on first use.

## Run

```bash
uvicorn server:app --host 0.0.0.0 --port 8100
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check with system stats |
| `/metrics` | GET | Processing metrics |
| `/remove-background` | POST | Background removal only → PNG with transparency |
| `/process` | POST | BG removal + white bg + padding + shadow → PNG |
| `/render-template` | POST | Add branding text bar to existing image |
| `/process-full` | POST | Full pipeline: BG removal → process → template |

### POST /process (main endpoint)

```bash
curl -X POST http://localhost:8100/process \
  -F "image=@product.jpg" \
  -F "background=FFFFFF" \
  -F "padding=0.1" \
  -F "shadow=true" \
  -F "width=1200" \
  -F "height=1200" \
  -o output.png
```

### POST /process-full

Same as `/process` plus template overlay:
- `template_text` (default: "usedcameragear.com")
- `bar_height` (default: 50)
- `font_size` (default: 20)

## Test Results

Test images in `test_output/`:
- `01_bg_removed.png` — Transparent background (640x427 RGBA)
- `02_processed.png` — White bg, centered, shadow (1200x1200 RGB)
- `03_final.png` — With branding bar (1200x1200 RGBA)
- `04_api_result.png` — Via API endpoint (1200x1200 RGB)

## What Works

- ✅ Background removal via u2net ONNX (good quality, ~2-5s per image on CPU)
- ✅ Clean white backgrounds with configurable padding
- ✅ Drop shadow generation
- ✅ Template/branding overlay
- ✅ Concurrency controls and request queuing
- ✅ Structured JSON logging
- ✅ Health/metrics endpoints

## What Doesn't / Known Issues

- ⚠️ `rembg` package won't install on Python 3.13/3.14 (llvmlite/numba build failure) — worked around with direct ONNX inference
- ⚠️ No GPU acceleration (CPU only, onnxruntime)
- ⚠️ u2net may struggle with complex/similar-colored backgrounds — consider isnet-general-use model as alternative
- ⚠️ No batch processing endpoint yet
- ⚠️ No authentication

## Dependencies

Core: `onnxruntime`, `fastapi`, `uvicorn`, `pillow`, `python-multipart`, `numpy`, `pooch`, `psutil`
Optional (installed but not strictly needed for core): `scipy`, `tqdm`
