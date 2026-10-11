"""Builds app icons from resources/branding/app-icon-source.png (dev tool, not shipped).

Turns the flat white background transparent, keeps the drop shadow as soft alpha,
crops to the artwork and writes:
  build/icon.ico   multi-size Windows icon (used by electron-builder)
  build/icon.png   1024 px
  resources/icon.png  512 px (window/taskbar icon at runtime)

Usage: python tools/branding/build_icons.py
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "resources/branding/app-icon-source.png"
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
BG_LUMA = 250  # pixels at least this bright and touching the border are background
SATURATED = 40  # chroma above this belongs to the artwork, never to the shadow
MARGIN = 0.03


def object_mask(rgb: np.ndarray) -> np.ndarray:
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    chroma = rgb.max(axis=2) - rgb.min(axis=2)

    near_white, _ = ndimage.label(luma >= BG_LUMA)
    border = np.unique(np.concatenate([near_white[0], near_white[-1], near_white[:, 0], near_white[:, -1]]))
    background = np.isin(near_white, border[border > 0])

    page = (luma >= BG_LUMA) & ~background
    labels, count = ndimage.label(page)
    if count == 0:
        raise SystemExit("No page found in source image")
    largest = np.argmax(ndimage.sum(page, labels, range(1, count + 1))) + 1
    artwork = (labels == largest) | ((chroma > SATURATED) & ~background)
    artwork = ndimage.binary_closing(artwork, iterations=2)
    return ndimage.binary_fill_holes(artwork)


def to_rgba(img: Image.Image) -> Image.Image:
    rgb = np.asarray(img.convert("RGB"), dtype=np.float64)
    mask = object_mask(rgb)
    luma = rgb @ np.array([0.299, 0.587, 0.114])

    # Outside the artwork, darkness becomes a black shadow with matching alpha.
    shadow_alpha = np.clip((255 - luma) * 1.6, 0, 255)
    alpha = np.where(mask, 255, shadow_alpha)
    color = np.where(mask[..., None], rgb, 0)
    rgba = np.dstack([color, alpha]).astype(np.uint8)
    return Image.fromarray(rgba)


def crop_square(img: Image.Image) -> Image.Image:
    alpha = np.asarray(img)[..., 3]
    ys, xs = np.nonzero(alpha > 8)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    content = img.crop(box)
    side = int(max(content.size) * (1 + 2 * MARGIN))
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(content, ((side - content.width) // 2, (side - content.height) // 2))
    return square


def main() -> None:
    icon = crop_square(to_rgba(Image.open(SOURCE)))
    (ROOT / "build").mkdir(exist_ok=True)
    icon.resize((1024, 1024), Image.LANCZOS).save(ROOT / "build/icon.png", optimize=True)
    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "resources/icon.png", optimize=True)
    icon.resize((256, 256), Image.LANCZOS).save(
        ROOT / "build/icon.ico", sizes=[(s, s) for s in ICO_SIZES]
    )
    print("Wrote build/icon.ico, build/icon.png, resources/icon.png")


if __name__ == "__main__":
    main()
