# Stage 1: Build dependencies
FROM python:3.12-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime
FROM python:3.12-slim

# Security: non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY *.py ./

# Create temp directory for image processing
RUN mkdir -p /tmp/image-service && chown appuser:appuser /tmp/image-service

# Pre-download the u2net model so it's cached in the image
RUN python -c "from rembg import new_session; new_session('u2net')" 2>/dev/null || true

USER appuser

EXPOSE 8100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8100/health')" || exit 1

ENV MAX_CONCURRENT=2 \
    MAX_QUEUE_SIZE=20 \
    REQUEST_TIMEOUT=120

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1", "--log-level", "warning"]
