# Gallery Canvas System — Design Document

## What It Is

An infinite-canvas component gallery inside the Canvas panel. Components from the user's project are auto-discovered, rendered as live previews via the Vite dev server, and displayed as draggable cards on a pannable/zoomable canvas. Claude can also add components via MCP tools.

## How It Works Today

### Data Flow

```
1. Component Discovery (main process)
   component-scanner.ts scans src/components/**/*.tsx|jsx|vue|svelte
   Returns: { name, filePath, relativePath }[]

2. Preview Harness Setup (main process)
   Writes __canvas_preview.html to project root
   Detects framework (React/Vue/Svelte) from package.json
   Detects main CSS file (src/index.css etc.)
   Harness includes: framework mount code, CSS import, postMessage API

3. Variant Creation (renderer)
   useAutoGallery: auto-scans on project load, creates GalleryVariant per component
   useMcpCommands: creates variants from Claude's canvas_add_to_gallery tool
   Each variant gets a previewUrl: http://localhost:5173/__canvas_preview.html?c=src/components/Button.tsx

4. Rendering (renderer)
   GalleryCard renders an <iframe> with src=previewUrl (live) or srcdoc (static HTML)
   Iframe loads harness → harness imports component → mounts it → renders

5. Layout (renderer)
   autoLayout() places cards in 3-column masonry grid (CARD_WIDTH=400, GAP=24)
   reflowColumns() prevents vertical overlap after size changes

6. Canvas (renderer)
   CanvasBoard provides pan (trackpad/middle-click), zoom (pinch/Ctrl+scroll)
   Viewport culling: only renders cards within view + 200px margin
```

### Key Files

| File | Role |
|------|------|
| `src/main/services/component-scanner.ts` | Discovery, harness HTML generation |
| `src/renderer/stores/gallery.ts` | GalleryVariant type, persistence, card positions |
| `src/renderer/components/Gallery/Gallery.tsx` | GalleryCard, GridView, toolbar |
| `src/renderer/components/Gallery/CanvasBoard.tsx` | Pan/zoom, culling, keyboard shortcuts |
| `src/renderer/components/Gallery/canvasLayout.ts` | Column-packing layout algorithm |
| `src/renderer/hooks/useAutoGallery.ts` | Auto-scan + dev server upgrade |
| `src/renderer/hooks/useMcpCommands.ts` | MCP command handlers |
| `src/preload/index.ts` | IPC bridge (component namespace) |

---

## What We Want

1. **Components render identically** in the gallery as they do on the preview page (localhost:5173)
2. **Cards fit their content** — a small button = small card, a hero section = large card
3. **Canvas always navigable** — pan/zoom works everywhere, never blocked by iframes
4. **Live updates** — editing a component file updates the gallery card via HMR

---

## Current Issues

### Issue 1: Components Don't Match the Preview Page

**Symptom:** AuroraButton in gallery shows a small dark rectangle with "Aurora" text. On the preview page it shows a large styled button with gradients, animations, "AURORA" uppercase text.

**Root Cause:** The preview harness (`__canvas_preview.html`) imports `src/index.css` (Tailwind + CSS variables), but **does not load the fonts declared in the project's `index.html`**.

The test project (`/Users/rosendolopez/TestCanvas/`) has:
- `index.html` line 8-9: `<link href="https://fonts.googleapis.com/css2?family=DM+Sans...&family=Syne...">`
- `src/index.css`: `@import "tailwindcss"` + CSS variables like `--font-display: 'Syne'`
- Components use Tailwind classes + inline styles + Framer Motion animations

The harness loads `src/index.css` (so Tailwind classes work), but the Google Fonts never load because they're in `index.html`, not in CSS. Components fall back to system fonts → different sizing, different appearance.

**Additionally:** Some components use `@keyframes` in inline `<style>` tags and Framer Motion for animations. These work in the harness, but the font mismatch changes how text renders, affecting button sizes and overall look.

**Fix needed:** Parse the project's `index.html` for `<link>` stylesheet tags and inject them into the harness `<head>`. This ensures fonts, icon libraries (Font Awesome, etc.), and any other external stylesheets match.

### Issue 2: Card Sizing Doesn't Match Content

**Symptom:** Small buttons render inside large white cards with wasted space. Or the opposite — tight-fit logic makes cards too small.

**Root Cause:** Two-tier sizing system has edge cases:

The harness CSS uses `body { width: fit-content }` and `#root { width: fit-content }` so the iframe's body shrinks to content. The harness's `reportDimensions()` measures `#root.getBoundingClientRect()` and sends dimensions via postMessage.

Problems:
- `width: fit-content` causes components with `width: 100%` to collapse to min-content
- The initial iframe renders at `RENDER_WIDTH=800px` but after tight-fit kicks in, the iframe shrinks to content width — components may re-layout differently at the smaller viewport
- The +32px padding added to dimensions (`rect.width + 32`) doesn't account for components that overflow their root (absolutely positioned elements, shadows, animations)
- If `reportDimensions` fires before animations/fonts load, measurements are wrong

**Current tight-fit logic:**
```
contentDims.width <= 500 → tight-fit mode (scale=1, iframe = content size)
contentDims.width > 500  → scaled mode (iframe=800px, CSS scale to fit card)
```

### Issue 3: Canvas Navigation Blocked by Iframes

**Symptom:** Trackpad pan/zoom stops working when cursor is over a gallery card.

**Root Cause:** Iframes are separate browsing contexts. Even with `pointer-events: none`, they capture wheel events independently of the parent document.

**Current fix:** A transparent overlay `<div>` sits on top of every iframe, capturing all mouse/wheel events and letting them bubble to the canvas. This works but means **you can never interact with the component** (no hover states, no clicking buttons).

**Trade-off:** Pan/zoom everywhere vs component interaction. Currently prioritizing navigation.

### Issue 4: Card Overlap After Size Changes

**Symptom:** When card heights change (e.g., dimensions arrive from iframe), cards below in the same column don't move down, causing overlap.

**Root Cause:** `autoLayout()` only positions NEW cards. Existing cards keep their positions. When a card's height increases, `reflowColumns()` pushes down overlapping cards, but this only runs after size measurements arrive — there's a visual jump.

### Issue 5: Stale Positions After Refresh

**Symptom:** After clearing and refreshing the gallery, old card positions persist because they're saved in settings keyed by project path.

**Root Cause:** `clearAll()` resets in-memory state but the debounced persist may not have flushed yet, or old positions get loaded before new scan completes.

---

## Architecture Complications

### The Iframe Problem

Iframes provide isolation (each component runs in its own document) but create three fundamental tensions:

1. **Style isolation vs style sharing** — Components need the project's CSS, but the harness is a separate HTML document. We must explicitly import every stylesheet the project uses.

2. **Event isolation vs canvas navigation** — The iframe's browsing context captures events independently. No CSS property fully prevents this. The overlay div is a workaround.

3. **Measurement accuracy** — `getBoundingClientRect()` inside an iframe measures in the iframe's coordinate space. If the iframe's viewport differs from the final card size, measurements may not predict the final visual size.

### The Vite Dev Server Dependency

Live preview only works when the dev server is running. The harness (`__canvas_preview.html`) is served by Vite, which handles:
- Module resolution (import paths)
- CSS processing (Tailwind JIT, PostCSS)
- HMR websocket connection
- Static asset serving

Without the dev server, components fall back to static `srcdoc` HTML (placeholder cards with no live rendering).

### Framework Detection Limitations

`resolveUIFramework()` reads `package.json` to pick React/Vue/Svelte mount code. This works for single-framework projects but fails for:
- Monorepos with multiple frameworks
- Projects using both React and Vue
- Non-standard package structures

### CSS Detection Limitations

`resolveMainCSS()` checks common file paths then parses the main entry file. It misses:
- CSS loaded via `index.html` `<link>` tags (fonts, icon libraries, CDN stylesheets)
- CSS imported in non-standard entry points
- CSS-in-JS solutions (styled-components, emotion) that don't use file imports
- Multiple CSS entry points

---

## Proposed Solution: Parse index.html for External Resources

The most impactful fix is to extract `<link>` stylesheet tags from the project's `index.html` and inject them into the harness. This catches fonts, icon libraries, and any CDN-hosted CSS.

**Implementation:**
```
resolveExternalLinks(projectPath):
  1. Read index.html
  2. Extract all <link rel="stylesheet" href="..."> and <link rel="preconnect" ...>
  3. Return as HTML string to inject into harness <head>

buildPreviewHtml(framework, mainCSS, externalLinks):
  Inject externalLinks into <head> before <style>
```

This single change would fix the font mismatch that causes most of the visual difference.

For the remaining sizing and layout issues, the tight-fit system needs refinement:
- Delay dimension measurement until fonts load (`document.fonts.ready`)
- Don't use `width: fit-content` on body — let components render at a reasonable viewport width, then measure
- Consider rendering at a fixed width (e.g., 400px) matching the card width, instead of 800px scaled down
