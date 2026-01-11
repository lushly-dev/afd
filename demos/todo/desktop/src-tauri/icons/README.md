# App Icons

Place the following icon files here for production builds:

- `32x32.png` - 32x32 PNG icon
- `128x128.png` - 128x128 PNG icon
- `128x128@2x.png` - 256x256 PNG icon (2x retina)
- `icon.icns` - macOS icon bundle
- `icon.ico` - Windows icon

## Generating Icons

You can use the Tauri icon generator:

```bash
pnpm tauri icon path/to/source-icon.png
```

This requires a source image of at least 1024x1024 pixels.
