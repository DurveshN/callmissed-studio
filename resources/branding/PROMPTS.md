# Branding image prompts

Generated with the CallMissed image API (`generate_image`), model `gpt-image-2`, 1024×1024.
Brand reference: CallMissed logo at https://docs.callmissed.com/logo.png (blue #2E8BEF → violet #8B3CF0 triskelion with circular nodes).

Icons are derived with `python tools/branding/build_icons.py` → `build/icon.ico`, `build/icon.png`, `resources/icon.png`.

## App icon — `app-icon-source.png` (chosen 2026-10-11)

Prompt:
> Premium app icon for "CallMissed Studio", a desktop image and PDF editor, designed to stay legible at 16 and 32 pixels. A single upright white document page with gently rounded corners and a folded top-right corner; the fold is tinted with a soft blue-to-violet gradient. The page fills most of the canvas. On the page, large and centered, a bold triskelion symbol — three thick curved swirling arms rotating around a common center, each arm ending in a solid round circle node — filled with a smooth gradient from bright blue (#2E8BEF) at top-left to violet (#8B3CF0) at bottom-right. Around the symbol, a solid (not dashed) violet selection rectangle with a medium-weight line and four clearly visible filled square transform handles at its corners, indicating the object was detected and selected. Very simple shapes, strong contrast, flat modern vector style in the Windows 11 Fluent icon language, one soft subtle shadow under the page, plain pure white background, perfectly centered, no text, no letters.

Negative: text, letters, words, watermark, photo, noise, clutter, dashed thin lines, tilt, extra symbols, busy details
