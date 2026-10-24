# ToneBench icon

Graphite background, platinum audio bars, and one restrained ice-blue accent.

- Original artwork: `output/imagegen/tonebench-icon-master.png`.
- Generation: imagegen CLI, user-specified API endpoint and `gpt-image-2.5-sunburst`, high quality, one square image.
- Full prompt: [`icon-prompt.txt`](icon-prompt.txt).
- Packaged icon: `macos/Resources/AppIcon.icns` and `AppIcon.png`.
- Website: `public/app-icon.png`, `favicon.png`, and `apple-touch-icon.png`.

Run `python3 scripts/build-icons.py` on macOS with Pillow installed to rebuild the derived assets. The script applies the corner mask, native icon padding and shadow, then packages all standard 16–1024 px icon representations with `iconutil`. Normal app builds use the committed assets and do not require Pillow or an image API key.
