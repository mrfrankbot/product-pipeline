"""Background removal using u2net ONNX model directly (no rembg dependency)."""

import io
import os
import numpy as np
from PIL import Image
import onnxruntime as ort
import pooch

MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
MODEL_HASH = None  # skip hash check
MODEL_DIR = os.path.expanduser("~/.u2net")

_session = None


def _get_model_path() -> str:
    """Download u2net.onnx if not cached."""
    path = os.path.join(MODEL_DIR, "u2net.onnx")
    if os.path.exists(path):
        return path
    os.makedirs(MODEL_DIR, exist_ok=True)
    print(f"Downloading u2net model to {path}...")
    pooch.retrieve(MODEL_URL, known_hash=None, fname="u2net.onnx", path=MODEL_DIR)
    return path


def _get_session() -> ort.InferenceSession:
    global _session
    if _session is None:
        model_path = _get_model_path()
        _session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    return _session


def _preprocess(img: Image.Image, size: int = 320) -> np.ndarray:
    """Resize, normalize, convert to NCHW float32."""
    img = img.convert("RGB").resize((size, size), Image.LANCZOS)
    arr = np.array(img).astype(np.float32) / 255.0
    # Normalize with ImageNet-ish mean/std
    mean = np.array([0.485, 0.456, 0.406])
    std = np.array([0.229, 0.224, 0.225])
    arr = (arr - mean) / std
    # HWC -> NCHW
    arr = arr.transpose(2, 0, 1)[np.newaxis, ...]
    return arr.astype(np.float32)


def _postprocess(output: np.ndarray, orig_size: tuple[int, int]) -> Image.Image:
    """Convert model output to alpha mask at original size."""
    mask = output.squeeze()
    # Normalize to 0-1
    mask = (mask - mask.min()) / (mask.max() - mask.min() + 1e-8)
    mask = (mask * 255).astype(np.uint8)
    mask_img = Image.fromarray(mask).resize(orig_size, Image.LANCZOS)
    return mask_img


def remove_background_pil(image: Image.Image) -> Image.Image:
    """Remove background from PIL Image, return RGBA PIL Image."""
    session = _get_session()
    orig_size = image.size
    input_tensor = _preprocess(image)
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: input_tensor})
    # u2net outputs multiple maps; first is the main one
    mask = _postprocess(outputs[0], orig_size)
    
    # Apply mask as alpha channel
    rgba = image.convert("RGBA")
    rgba.putalpha(mask)
    return rgba


def remove_background(image_bytes: bytes) -> bytes:
    """Remove background from image bytes, return PNG bytes with transparency."""
    img = Image.open(io.BytesIO(image_bytes))
    result = remove_background_pil(img)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return buf.getvalue()
