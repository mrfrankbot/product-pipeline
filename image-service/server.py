"""FastAPI server for local image processing (PhotoRoom replacement).

Production-hardened with:
- Concurrency controls (semaphore-based)
- Request timeouts
- Structured JSON logging with request IDs
- Comprehensive error handling
- Graceful shutdown
- Health/metrics endpoints
- Memory management
"""

import asyncio
import gc
import io
import os
import platform
import signal
import sys
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Optional

import psutil
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image

from bg_removal import remove_background, remove_background_pil
from image_processor import process_image
from logger import get_logger, set_request_id
from template_renderer import render_template

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "2"))
MAX_QUEUE_SIZE = int(os.getenv("MAX_QUEUE_SIZE", "20"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "120"))  # seconds
MAX_IMAGE_SIZE = int(os.getenv("MAX_IMAGE_SIZE", str(50 * 1024 * 1024)))  # 50 MB
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", str(100_000_000)))  # 100 MP
MIN_DISK_MB = int(os.getenv("MIN_DISK_MB", "500"))

# PIL decompression bomb protection
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

log = get_logger("server")

# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
@dataclass
class Metrics:
    total_requests: int = 0
    total_success: int = 0
    total_errors: int = 0
    total_timeouts: int = 0
    total_rejected: int = 0  # queue full
    processing_times: deque = field(default_factory=lambda: deque(maxlen=1000))
    stage_times: dict = field(default_factory=lambda: {
        "bg_removal": deque(maxlen=1000),
        "processing": deque(maxlen=1000),
        "template": deque(maxlen=1000),
    })
    current_processing: int = 0
    current_queued: int = 0

    def avg_time(self) -> float:
        return sum(self.processing_times) / len(self.processing_times) if self.processing_times else 0

    def error_rate(self) -> float:
        return self.total_errors / self.total_requests if self.total_requests else 0

    def avg_stage(self, stage: str) -> float:
        d = self.stage_times.get(stage, [])
        return sum(d) / len(d) if d else 0

    def to_dict(self) -> dict:
        return {
            "total_requests": self.total_requests,
            "total_success": self.total_success,
            "total_errors": self.total_errors,
            "total_timeouts": self.total_timeouts,
            "total_rejected": self.total_rejected,
            "avg_processing_time_s": round(self.avg_time(), 3),
            "error_rate": round(self.error_rate(), 4),
            "current_processing": self.current_processing,
            "current_queued": self.current_queued,
            "avg_stage_times_s": {
                k: round(self.avg_stage(k), 3) for k in self.stage_times
            },
        }


metrics = Metrics()
_start_time = time.time()

# ---------------------------------------------------------------------------
# Concurrency control
# ---------------------------------------------------------------------------
_semaphore: Optional[asyncio.Semaphore] = None
_shutdown_event: Optional[asyncio.Event] = None


def _check_disk_space():
    """Raise if disk space is critically low."""
    try:
        usage = psutil.disk_usage("/")
        free_mb = usage.free / (1024 * 1024)
        if free_mb < MIN_DISK_MB:
            raise HTTPException(503, f"Low disk space: {free_mb:.0f} MB free (min {MIN_DISK_MB} MB)")
    except HTTPException:
        raise
    except Exception:
        pass  # non-critical


async def _acquire_slot():
    """Acquire a processing slot, respecting queue limits."""
    if metrics.current_queued >= MAX_QUEUE_SIZE:
        metrics.total_rejected += 1
        raise HTTPException(503, f"Server busy: {metrics.current_queued} requests queued (max {MAX_QUEUE_SIZE})")
    metrics.current_queued += 1
    try:
        await _semaphore.acquire()
    finally:
        metrics.current_queued -= 1
    metrics.current_processing += 1


def _release_slot():
    metrics.current_processing -= 1
    _semaphore.release()


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _semaphore, _shutdown_event
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    _shutdown_event = asyncio.Event()

    log.info("server_start", max_concurrent=MAX_CONCURRENT, max_queue=MAX_QUEUE_SIZE,
             timeout=REQUEST_TIMEOUT, max_image_mb=MAX_IMAGE_SIZE // (1024*1024))

    # Graceful shutdown handler
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda s=sig: _handle_shutdown(s))

    yield

    log.info("server_stop", uptime=round(time.time() - _start_time, 1), **metrics.to_dict())


def _handle_shutdown(sig):
    log.info("shutdown_signal", signal=sig.name, in_flight=metrics.current_processing)
    _shutdown_event.set()


app = FastAPI(title="Image Processing Service", version="2.0.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Middleware: request ID + logging
# ---------------------------------------------------------------------------
@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    set_request_id(request_id)
    request.state.request_id = request_id
    request.state.start_time = time.time()

    log.info("request_start", method=request.method, path=request.url.path, request_id=request_id)

    try:
        response = await call_next(request)
        elapsed = round(time.time() - request.state.start_time, 3)
        log.info("request_end", method=request.method, path=request.url.path,
                 status=response.status_code, elapsed_s=elapsed, request_id=request_id)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Processing-Time"] = str(elapsed)
        return response
    except Exception as e:
        elapsed = round(time.time() - request.state.start_time, 3)
        log.error("request_error", method=request.method, path=request.url.path,
                  error=str(e), elapsed_s=elapsed, request_id=request_id)
        raise


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    log.error("unhandled_error", error=str(exc), type=type(exc).__name__, request_id=request_id)
    return JSONResponse(status_code=500, content={
        "error": "Internal server error",
        "detail": str(exc) if os.getenv("DEBUG") else "An unexpected error occurred",
        "request_id": request_id,
    })


# ---------------------------------------------------------------------------
# Helper: read & validate image
# ---------------------------------------------------------------------------
async def _read_image(upload: UploadFile) -> tuple[bytes, Image.Image]:
    """Read uploaded file, validate it's an image, return (bytes, PIL.Image)."""
    data = await upload.read()
    if len(data) == 0:
        raise HTTPException(400, "Empty file uploaded")
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(413, f"Image too large: {len(data) / 1024 / 1024:.1f} MB (max {MAX_IMAGE_SIZE // (1024*1024)} MB)")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()  # check for corruption
        # Re-open after verify (verify consumes the image)
        img = Image.open(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(400, f"Invalid or corrupt image: {e}")
    return data, img


def _to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    result = buf.getvalue()
    buf.close()
    return result


# ---------------------------------------------------------------------------
# Helper: run with timeout + concurrency
# ---------------------------------------------------------------------------
async def _run_processing(func, *args, **kwargs):
    """Run a sync function in executor with timeout and concurrency control."""
    _check_disk_space()
    metrics.total_requests += 1
    await _acquire_slot()
    try:
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: func(*args, **kwargs)),
            timeout=REQUEST_TIMEOUT,
        )
        metrics.total_success += 1
        return result
    except asyncio.TimeoutError:
        metrics.total_timeouts += 1
        metrics.total_errors += 1
        log.error("processing_timeout", timeout=REQUEST_TIMEOUT)
        raise HTTPException(504, f"Processing timed out after {REQUEST_TIMEOUT}s")
    except HTTPException:
        metrics.total_errors += 1
        raise
    except Exception as e:
        metrics.total_errors += 1
        log.error("processing_error", error=str(e), type=type(e).__name__)
        raise HTTPException(500, f"Processing failed: {e}")
    finally:
        _release_slot()
        gc.collect()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    proc = psutil.Process()
    mem = proc.memory_info()
    disk = psutil.disk_usage("/")
    cpu_pct = psutil.cpu_percent(interval=0)
    return {
        "status": "ok" if not (_shutdown_event and _shutdown_event.is_set()) else "shutting_down",
        "uptime_s": round(time.time() - _start_time, 1),
        "service": "image-processing",
        "version": "2.0.0",
        "system": {
            "cpu_percent": cpu_pct,
            "memory_rss_mb": round(mem.rss / 1024 / 1024, 1),
            "memory_vms_mb": round(mem.vms / 1024 / 1024, 1),
            "disk_free_mb": round(disk.free / 1024 / 1024, 1),
            "disk_percent_used": disk.percent,
            "pid": proc.pid,
            "platform": platform.system(),
        },
        "capacity": {
            "max_concurrent": MAX_CONCURRENT,
            "current_processing": metrics.current_processing,
            "current_queued": metrics.current_queued,
            "max_queue": MAX_QUEUE_SIZE,
        },
    }


@app.get("/metrics")
async def metrics_endpoint():
    return metrics.to_dict()


@app.post("/remove-background")
async def remove_bg_endpoint(image: UploadFile = File(...)):
    """Remove background from uploaded image, return PNG with transparency."""
    data, _ = await _read_image(image)

    def _do():
        t0 = time.time()
        result = remove_background(data)
        metrics.stage_times["bg_removal"].append(time.time() - t0)
        metrics.processing_times.append(time.time() - t0)
        return result

    result = await _run_processing(_do)
    return Response(content=result, media_type="image/png")


@app.post("/process")
async def process_endpoint(
    image: UploadFile = File(...),
    background: str = Form("FFFFFF"),
    padding: float = Form(0.1),
    shadow: bool = Form(True),
    width: int = Form(1200),
    height: int = Form(1200),
):
    """Remove background and process image."""
    data, pil_img = await _read_image(image)

    def _do():
        t0 = time.time()
        fg = remove_background_pil(pil_img)
        t1 = time.time()
        metrics.stage_times["bg_removal"].append(t1 - t0)

        result = process_image(fg, background_color=background, padding=padding,
                               shadow=shadow, output_size=(width, height))
        t2 = time.time()
        metrics.stage_times["processing"].append(t2 - t1)
        metrics.processing_times.append(t2 - t0)
        return _to_png_bytes(result)

    result = await _run_processing(_do)
    return Response(content=result, media_type="image/png")


@app.post("/render-template")
async def render_template_endpoint(
    image: UploadFile = File(...),
    text: str = Form("usedcameragear.com"),
    bar_height: int = Form(50),
    font_size: int = Form(20),
):
    """Overlay text template bar on an image."""
    _, pil_img = await _read_image(image)

    def _do():
        t0 = time.time()
        result = render_template(pil_img, text=text, bar_height=bar_height, font_size=font_size)
        metrics.stage_times["template"].append(time.time() - t0)
        metrics.processing_times.append(time.time() - t0)
        return _to_png_bytes(result)

    result = await _run_processing(_do)
    return Response(content=result, media_type="image/png")


@app.post("/process-full")
async def process_full_endpoint(
    image: UploadFile = File(...),
    background: str = Form("FFFFFF"),
    padding: float = Form(0.1),
    shadow: bool = Form(True),
    width: int = Form(1200),
    height: int = Form(1200),
    template_text: str = Form("usedcameragear.com"),
    bar_height: int = Form(50),
    font_size: int = Form(20),
):
    """Full pipeline: remove bg → process → template overlay."""
    data, pil_img = await _read_image(image)

    def _do():
        t0 = time.time()
        fg = remove_background_pil(pil_img)
        t1 = time.time()
        metrics.stage_times["bg_removal"].append(t1 - t0)

        processed = process_image(fg, background_color=background, padding=padding,
                                  shadow=shadow, output_size=(width, height))
        t2 = time.time()
        metrics.stage_times["processing"].append(t2 - t1)

        result = render_template(processed, text=template_text,
                                 bar_height=bar_height, font_size=font_size)
        t3 = time.time()
        metrics.stage_times["template"].append(t3 - t2)
        metrics.processing_times.append(t3 - t0)
        return _to_png_bytes(result)

    result = await _run_processing(_do)
    return Response(content=result, media_type="image/png")
