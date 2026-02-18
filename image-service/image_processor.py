"""Image processing: background, padding, shadow, resize."""

from PIL import Image, ImageFilter
import numpy as np


def add_shadow(
    foreground: Image.Image,
    offset: tuple[int, int] = (5, 15),
    blur_radius: int = 20,
    opacity: float = 0.3,
) -> Image.Image:
    """Create a soft drop shadow from the alpha channel of the foreground."""
    alpha = foreground.split()[3]
    # Create shadow layer
    shadow = Image.new("RGBA", foreground.size, (0, 0, 0, 0))
    shadow_alpha = alpha.copy()
    # Apply opacity
    shadow_alpha = shadow_alpha.point(lambda p: int(p * opacity))
    shadow.putalpha(shadow_alpha)
    # Blur
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    # Offset: paste shadow on larger canvas then crop
    w, h = foreground.size
    canvas = Image.new("RGBA", (w + abs(offset[0]) * 2, h + abs(offset[1]) * 2), (0, 0, 0, 0))
    canvas.paste(shadow, (max(offset[0], 0), max(offset[1], 0)), shadow)
    # Crop back to original size
    canvas = canvas.crop((0, 0, w, h))
    return canvas


def process_image(
    foreground: Image.Image,
    background_color: str = "FFFFFF",
    padding: float = 0.1,
    shadow: bool = True,
    output_size: tuple[int, int] = (1200, 1200),
) -> Image.Image:
    """
    Full image processing pipeline:
    1. Fit subject into padded area (maintain aspect ratio, center)
    2. Add shadow if requested
    3. Composite onto solid background
    4. Resize to output_size
    """
    fg = foreground.convert("RGBA")
    target_w, target_h = output_size

    # Calculate inner area (after padding)
    inner_w = int(target_w * (1 - 2 * padding))
    inner_h = int(target_h * (1 - 2 * padding))

    # Resize foreground to fit inner area, maintaining aspect ratio
    fg.thumbnail((inner_w, inner_h), Image.LANCZOS)

    # Create canvas
    canvas = Image.new("RGBA", output_size, (0, 0, 0, 0))

    # Center the foreground
    paste_x = (target_w - fg.width) // 2
    paste_y = (target_h - fg.height) // 2

    # Add shadow
    if shadow:
        shadow_layer = add_shadow(fg)
        canvas.paste(shadow_layer, (paste_x, paste_y), shadow_layer)

    # Paste foreground
    canvas.paste(fg, (paste_x, paste_y), fg)

    # Create background
    r = int(background_color[0:2], 16)
    g = int(background_color[2:4], 16)
    b = int(background_color[4:6], 16)
    bg = Image.new("RGBA", output_size, (r, g, b, 255))

    # Composite
    result = Image.alpha_composite(bg, canvas)
    return result.convert("RGB")
