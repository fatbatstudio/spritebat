# 🦇 SpriteBat

Browser-based sprite sheet compositor for layering, tinting, and combining 2D game animation assets into unified sprite sheets.

**By [FATBAT Studio](https://eidolware.com/about/)** · [Bluesky](https://bsky.app/profile/fatbat.studio) · [Ko-fi](https://ko-fi.com/fatbatstudio)

## Features

- **Composer** — Stack layers with per-layer HSL color shift, opacity, offsets, and per-frame position nudge. Drag to reposition on the canvas, merge layers down, undo/redo all actions. Each layer can have its own input grid layout.
- **Asset Splitter** — Load a reference image or import directly from a composer layer (full sheet or a specific frame). Box/lasso select regions (Shift to add, Alt to subtract), resize handles for fine-tuning, then extract as a trimmed PNG to the library or as a new layer.
- **Library** — Store extracted assets for reuse. Duplicate, flip H/V, import into specific frame cells, or add as a full layer. Save/load library assets as standalone .spritebat files, or import assets from another project.
- **Tile to Sheet** — Stamp a single-frame asset across chosen directions and frames to build a full sprite sheet in one click.
- **Clear Frames** — Erase specific cells from a layer so you can replace them with new content.
- **Animated Preview** — Preview animations per direction with forward, reverse, and ping-pong playback modes. Click frame indicators to jump to any frame.
- **Configurable Layouts** — Set frame size, direction count (4 or 8), frames per direction, and separate input/export grid layouts. Click the sheet preview to jump to any frame.
- **Export** — Download the composited sheet as PNG, individual frames as ZIP, or animated GIFs per direction with forward/reverse/ping-pong support. Export the selected layer only as a sheet or single frame. Scale 1–4× for all formats.
- **Projects** — Save and load .spritebat project files that preserve all layers, library assets, and UI state. Keyboard shortcuts for undo (Ctrl/Cmd+Z) and redo (Ctrl/Cmd+Y).

## Getting Started

```bash
npm install
npm run dev
```

This starts a local dev server with hot module replacement. Open the URL shown in your terminal.

To build for production:

```bash
npm run build
```

Output goes to the `dist/` folder.

## Tech Stack

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) (strict) + [Vite 7](https://vite.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) for styling
- [JSZip](https://stuk.github.io/jszip/) for .spritebat project files (ZIP-based format)
- [file-saver](https://github.com/nicolo-ribaudo/FileSaver.js) for download triggers
- [gifenc](https://github.com/mattdesl/gifenc) for animated GIF export

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

SpriteBat is free and open-source software licensed under the [GNU General Public License v3.0](LICENSE).

© 2025 FATBAT Studio

---

If you find SpriteBat helpful, consider [buying me a coffee on Ko-fi](https://ko-fi.com/fatbatstudio) ☕
