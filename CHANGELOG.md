# Changelog

All notable changes to SpriteBat are documented here.

## v1.04 - 2026-02-26

### Fixes
- Bugfixes to undo/redo actions and library asset management.

## v1.03 - 2026-02-22

### New Features
- **What's New dialog** accessible from the About screen to view version history in-app
- **itch.io deployment** via GitHub Actions for automatic publishing on push to main

### Improvements
- Layer Properties bar redesigned into 3 atomic sections (identity, HSL, actions) that wrap as units on tablets and smaller screens

## v1.02 - 2026-02-21

### New Features
- **Try Example** button in the header loads a bundled tutorial project to explore SpriteBat's features
- **Library tag sidebar** with tag counts, "All" / "Untagged" filters, and alphabetical tag list
- **Library drag-to-reorder** for manually sorting assets (disabled when filtering)
- **Library search** now filters by both name and tags
- **Asset Splitter "Load from Layer"** imports a composer layer directly (full sheet or pick a specific frame)
- **Asset Splitter spacebar pan** and middle-click pan for navigating large images
- **Asset Splitter extract with tags** for batch-tagging extracted assets
- **HSL Adjust dialog** with precise numeric inputs for hue, saturation, lightness, and opacity
- **PWA / Install & Offline** support via service worker, with automatic update notifications
- **OpenGraph & Twitter Card meta tags** for rich link previews when sharing
- **Mobile responsive UI** with hamburger menu, slide-over panels, collapsible bottom bars, bottom-sheet HSL dialog, and touch-friendly targets (32px minimum)

### Improvements
- Two-row desktop header prevents overlap on smaller screens
- Tab switcher centered without absolute positioning
- About dialog is scrollable on small viewports
- Canvas touch support with `touchAction: 'none'` for tablet layer dragging
- Splitter zoom level persisted in app state across tab switches

## v1.01 - 2026-02-20

### New Features
- **Save/load library** as standalone .spritebat files
- **Export per-layer** sheet and single frame
- **GIF export** for individual directions and all directions (forward/reverse/ping-pong)
- **Asset Splitter** with box and lasso selection, resize handles, add/subtract modes
- **Merge layers down** to combine two layers into one
- **HSL color shift** with per-pixel processing and caching
- **Per-frame position offsets** with dedicated offset editing mode
- **Import into specific frame cells** via grid picker modal
- **Clear specific frame cells** to erase and replace content
- **Tile to Sheet** to stamp a single-frame asset across directions/frames
- **Undo/redo** for all layer and library actions with keyboard shortcuts (Ctrl+Z / Ctrl+Y)

### Improvements
- GitHub Pages deployment with custom domain (spritebat.fatbat.studio)
- About dialog with feature list and social links
- GPL-3.0 license added

## v1.0 - 2026-02-19

### Initial Release
- **Composer** with multi-layer sprite sheet compositing
- **Layer system** with type classification, visibility toggle, opacity, and reordering
- **Animated Preview** with forward, reverse, and ping-pong playback
- **Configurable project settings** for frame size, direction count, frames per direction, and grid layouts
- **Export** composited sheet as PNG, individual frames as ZIP
- **.spritebat project files** (ZIP-based) for saving and loading full project state
- **Asset Library** for storing and organizing extracted sprites

