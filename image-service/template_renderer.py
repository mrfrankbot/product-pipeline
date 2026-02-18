"""Template overlay: adds branding text bar at the bottom of images."""

from PIL import Image, ImageDraw, ImageFont
import os


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Try to load a clean sans-serif font."""
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSText.ttf",
        "/System/Library/Fonts/SFCompact.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def render_template(
    image: Image.Image,
    text: str = "usedcameragear.com",
    bar_height: int = 50,
    font_size: int = 20,
    bar_color: tuple[int, int, int, int] = (0, 0, 0, 160),
    text_color: tuple[int, int, int, int] = (255, 255, 255, 255),
) -> Image.Image:
    """
    Overlay a semi-transparent text bar at the bottom of the image.
    """
    img = image.convert("RGBA")
    w, h = img.size

    # Create overlay for the bar
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Draw semi-transparent bar at bottom
    draw.rectangle([(0, h - bar_height), (w, h)], fill=bar_color)

    # Draw text centered in bar
    font = _get_font(font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    text_x = (w - text_w) // 2
    text_y = h - bar_height + (bar_height - text_h) // 2
    draw.text((text_x, text_y), text, fill=text_color, font=font)

    # Composite
    result = Image.alpha_composite(img, overlay)
    return result
