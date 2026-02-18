#!/bin/bash
set -e
cd "$(dirname "$0")"

# Use python3.13 (onnxruntime doesn't support 3.14 yet)
PYTHON="${PYTHON:-python3.13}"
MAX_RESTARTS="${MAX_RESTARTS:-10}"
RESTART_DELAY="${RESTART_DELAY:-3}"

if ! command -v "$PYTHON" &>/dev/null; then
  echo "Error: $PYTHON not found. Install Python 3.13 or set PYTHON env var."
  exit 1
fi

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  "$PYTHON" -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

# Auto-restart loop
restarts=0
while [ "$restarts" -lt "$MAX_RESTARTS" ]; do
  echo "[$(date)] Starting image service (restart #$restarts)..."
  uvicorn server:app --host 0.0.0.0 --port 8100 --workers 1 --log-level warning && break
  exit_code=$?
  restarts=$((restarts + 1))
  echo "[$(date)] Server exited with code $exit_code. Restarting in ${RESTART_DELAY}s... ($restarts/$MAX_RESTARTS)"
  sleep "$RESTART_DELAY"
done

if [ "$restarts" -ge "$MAX_RESTARTS" ]; then
  echo "[$(date)] Max restarts ($MAX_RESTARTS) reached. Giving up."
  exit 1
fi
