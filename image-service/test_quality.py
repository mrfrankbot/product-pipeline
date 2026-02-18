"""Quality testing script for image processing service."""
import os
import sys
import time
import json
import requests
from pathlib import Path
from PIL import Image
import numpy as np

SERVICE_URL = os.environ.get("SERVICE_URL", "http://localhost:8100")
ORIGINALS_DIR = Path(__file__).parent / "test-results" / "originals"
RESULTS_BASE = Path(__file__).parent / "test-results"


def wait_for_service(timeout=600, interval=30):
    """Wait for service to be healthy."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(f"{SERVICE_URL}/health", timeout=5)
            if r.status_code == 200:
                print(f"Service is up! {r.json()}")
                return True
        except Exception:
            pass
        print(f"Service not ready, waiting {interval}s...")
        time.sleep(interval)
    return False


def process_image(image_path, output_dir, **params):
    """Process a single image through the service."""
    defaults = {
        "background": "FFFFFF",
        "padding": "0.1",
        "shadow": "true",
        "width": "1200",
        "height": "1200",
    }
    defaults.update(params)
    
    with open(image_path, "rb") as f:
        files = {"image": (image_path.name, f, "image/jpeg")}
        data = defaults
        r = requests.post(f"{SERVICE_URL}/process", files=files, data=data, timeout=120)
    
    if r.status_code == 200:
        out_path = output_dir / f"{image_path.stem}_processed.png"
        with open(out_path, "wb") as f:
            f.write(r.content)
        return out_path
    else:
        print(f"ERROR processing {image_path.name}: {r.status_code} {r.text[:200]}")
        return None


def analyze_quality(original_path, processed_path):
    """Analyze quality metrics of a processed image."""
    proc = Image.open(processed_path).convert("RGBA")
    w, h = proc.size
    arr = np.array(proc)
    
    metrics = {}
    
    # Check for white halos: look at edge pixels around subject
    # Convert to grayscale alpha analysis
    alpha = arr[:, :, 3]
    
    # Find subject boundary (where alpha transitions)
    # Look for semi-transparent pixels (potential halo zone)
    semi_transparent = np.sum((alpha > 10) & (alpha < 240))
    total_pixels = w * h
    metrics["semi_transparent_ratio"] = float(semi_transparent) / total_pixels
    
    # Check padding consistency
    # Find bounding box of non-background content
    rgb = arr[:, :, :3]
    bg_color = rgb[0, 0]  # top-left corner = background
    is_bg = np.all(np.abs(rgb.astype(int) - bg_color.astype(int)) < 10, axis=2)
    
    non_bg_coords = np.where(~is_bg)
    if len(non_bg_coords[0]) > 0:
        top = non_bg_coords[0].min()
        bottom = non_bg_coords[0].max()
        left = non_bg_coords[1].min()
        right = non_bg_coords[1].max()
        
        padding_top = top / h
        padding_bottom = (h - bottom) / h
        padding_left = left / w
        padding_right = (w - right) / w
        
        metrics["padding"] = {
            "top": round(padding_top, 3),
            "bottom": round(padding_bottom, 3),
            "left": round(padding_left, 3),
            "right": round(padding_right, 3),
        }
        
        # Centering score (0=perfect, higher=worse)
        h_center = abs((left + right) / 2 - w / 2) / w
        v_center = abs((top + bottom) / 2 - h / 2) / h
        metrics["centering_offset"] = {"horizontal": round(h_center, 3), "vertical": round(v_center, 3)}
    
    # Shadow analysis: look for dark pixels below subject
    if len(non_bg_coords[0]) > 0:
        below_subject = arr[bottom:, :, :]
        if below_subject.size > 0:
            dark_below = np.sum(np.all(below_subject[:, :, :3] < 200, axis=2))
            metrics["shadow_pixels_below"] = int(dark_below)
            metrics["has_visible_shadow"] = dark_below > 100
    
    # Overall brightness/contrast check
    gray = np.mean(rgb, axis=2)
    metrics["mean_brightness"] = round(float(np.mean(gray)), 1)
    metrics["contrast_std"] = round(float(np.std(gray)), 1)
    
    return metrics


def run_iteration(iteration_name, params=None):
    """Run a full test iteration."""
    if params is None:
        params = {}
    
    output_dir = RESULTS_BASE / iteration_name
    output_dir.mkdir(exist_ok=True)
    
    results = {}
    for img_path in sorted(ORIGINALS_DIR.glob("*.jpg")):
        print(f"  Processing {img_path.name}...")
        out = process_image(img_path, output_dir, **params)
        if out:
            metrics = analyze_quality(img_path, out)
            results[img_path.stem] = metrics
            print(f"    Centering: h={metrics.get('centering_offset', {}).get('horizontal', 'N/A')}, "
                  f"v={metrics.get('centering_offset', {}).get('vertical', 'N/A')}")
            print(f"    Shadow: {metrics.get('has_visible_shadow', 'N/A')}")
    
    # Save metrics
    with open(output_dir / "metrics.json", "w") as f:
        json.dump(results, f, indent=2)
    
    return results


if __name__ == "__main__":
    if not wait_for_service():
        print("Service never came up. Exiting.")
        sys.exit(1)
    
    # Iteration 1: Default params
    print("\n=== ITERATION 1: Default parameters ===")
    r1 = run_iteration("iteration-1")
    
    # Iteration 2: Adjusted shadow and padding
    print("\n=== ITERATION 2: Enhanced shadow + more padding ===")
    r2 = run_iteration("iteration-2", {"padding": "0.12", "shadow": "true"})
    
    # Iteration 3: Fine-tuned
    print("\n=== ITERATION 3: Fine-tuned ===")
    r3 = run_iteration("iteration-3", {"padding": "0.15"})
    
    print("\nDone! Check test-results/ for outputs.")
