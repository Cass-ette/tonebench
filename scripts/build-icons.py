#!/usr/bin/env python3
"""Package the approved artwork into Mac and web icons (requires Pillow)."""

from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "output/imagegen/tonebench-icon-master.png"


def main():
    source = Image.open(SOURCE).convert("RGBA")
    if source.width != source.height:
        raise ValueError("Icon master must be square")

    # Leave native macOS icon padding; mask only the generated tile, not the glyph.
    scale = 3
    canvas_size, inset, radius = 1024, 64, 198
    tile_size = canvas_size - 2 * inset
    mask = Image.new("L", (tile_size * scale, tile_size * scale))
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, tile_size * scale - 1, tile_size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    mask = mask.resize((tile_size, tile_size), Image.Resampling.LANCZOS)
    tile = source.resize((tile_size, tile_size), Image.Resampling.LANCZOS)
    tile.putalpha(mask)
    shadow = Image.new("RGBA", (canvas_size, canvas_size))
    shadow.paste((0, 0, 0, 95), (inset, inset + 13), mask)
    icon = shadow.filter(ImageFilter.GaussianBlur(15))
    icon.alpha_composite(tile, (inset, inset))

    resources = ROOT / "macos/Resources"
    resources.mkdir(parents=True, exist_ok=True)
    icon.save(resources / "AppIcon.png", optimize=True)
    with tempfile.TemporaryDirectory(prefix="tonebench-icon-") as directory:
        iconset = Path(directory) / "AppIcon.iconset"
        iconset.mkdir()
        for points in [16, 32, 128, 256, 512]:
            for density in [1, 2]:
                size = points * density
                suffix = "@2x" if density == 2 else ""
                icon.resize((size, size), Image.Resampling.LANCZOS).save(
                    iconset / f"icon_{points}x{points}{suffix}.png"
                )
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(resources / "AppIcon.icns")],
            check=True,
        )
    for name, size in [("app-icon.png", 128), ("favicon.png", 32)]:
        icon.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / "public" / name, optimize=True)
    source.resize((180, 180), Image.Resampling.LANCZOS).save(
        ROOT / "public/apple-touch-icon.png", optimize=True
    )
    print("Built Mac .icns and PNGs for the app, website and touch icon.")


if __name__ == "__main__":
    main()
