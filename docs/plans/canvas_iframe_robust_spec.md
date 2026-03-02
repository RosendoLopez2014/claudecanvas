# Canvas Gallery (iframes) — Robust, “no heavy card”, exact-project rendering, fully interactable

This spec upgrades your current iframe-based canvas gallery so that:
- You see **only the component output** on the canvas (no bulky perimeter card UI baked into the preview).
- Previews **match the main project exactly** (same `index.html` head resources, same Tailwind/theme/fonts, same runtime code paths).
- Previews are **live + interactable** (hover, click, type) *without losing* pan/zoom/drag UX.
- The system is stable (resizing, layout, persistence) and extensible (compare mode, inspector overlays later).

---

## Goals

1. **Exact fidelity**
   - Same fonts, CSS variables, Tailwind preflight, and any `<head>` resources used by the main app.
   - No “preview-only CSS” divergence.

2. **Only the element**
   - The canvas shows the component’s rendered pixels.
   - Any chrome (name, file path, controls) must be **outside** the rendered component area (as an overlay in the parent UI), not inside the preview.

3. **Interactable**
   - Users can click buttons, hover states, type in inputs, open dropdowns.
   - Still supports canvas pan/zoom/drag, via explicit interaction modes.

4. **Robust sizing**
   - The preview auto-sizes to the component’s true content size (after fonts load).
   - No `fit-content` breakage for `w-full` / `width:100%` components.

---

## Non-goals (for now)

- Element-level selection inside the component (DevTools-style node selection).  
  (Can be added later via iframe instrumentation, but not required for the “review 3 hero variants” flow.)

---

## High-level architecture

**Parent (Canvas App)**
- Owns: pan/zoom, card positions, selection, minimal overlay UI, persistence.
- Embeds: one iframe per component preview.
- Receives: size + readiness events from each iframe.
- Switches: input routing between “Navigate mode” and “Interact mode”.

**Iframe Harness (Preview Runtime)**
- A single HTML/route that:
  - Loads the same head resources as your main app.
  - Dynamically imports and renders the target component from the main codebase.
  - Measures size continuously and reports it to the parent.

---

## 1) Remove the “heavy perimeter card” by separating *chrome* from *pixels*

### Current anti-pattern
- The preview itself contains UI wrapper (title bar, padding, big border).
- Result: you never see “just the component”.

### New pattern
- The iframe renders **only** the component output on a transparent page.
- The parent draws any UI around it (optional), using an overlay layer.

**Parent layering (recommended)**
- Layer A: Canvas background/grid (optional)
- Layer B: iframe nodes (the pixels)
- Layer C: selection outlines, resize handles, name label, hover buttons (optional)
- Layer D: navigation overlay (to capture pan/zoom in Navigate mode)

This lets you keep the canvas clean, and only show chrome when selected/hovered.

---

## 2) Make the iframe output visually identical to the main project

### Core rule
**Your preview must ingest `index.html` head resources, not guess them.**

Because many projects load fonts, preconnects, icon sets, or theme scripts in `index.html` rather than in CSS files.

#### Implementation options

**Option A (best): Serve a dedicated harness route that *reuses* the app’s index.html head**
- Add a Vite route (or dev server middleware) for `/__canvas_preview`.
- It returns an HTML document whose `<head>` is cloned from your app’s `index.html`, plus a small harness script.

**Option B: Runtime “head sync”**
- Parent requests `/index.html`, parses `<head>`, injects the relevant tags into iframe.
- Works, but more moving parts.

**What to copy**
- `<link rel="stylesheet" ...>`
- `<link rel="preconnect" ...>`, `<link rel="dns-prefetch" ...>`
- `<style>` tags used for theme variables
- Only include `<script>` tags if they affect paint/layout/theme initialization. Skip analytics.

---

## 3) Harness requirements (the iframe page)

### Harness HTML rules
- `html, body { margin: 0; padding: 0; background: transparent; }`
- No wrapper UI. No padding. No border.
- Mount point: a single `#root`.
- Optional: a “measurement wrapper” that is invisible.

### Harness runtime responsibilities
1. **Render** the target component from the main project code.
2. **Wait for fonts** to settle (`document.fonts.ready`) before finalizing initial size.
3. **Measure size** continuously (`ResizeObserver`).
4. **Report** readiness + size via `postMessage` to parent.
5. **Receive commands** from parent:
   - set props
   - toggle viewport mode (fixed width / responsive)
   - request screenshot later (optional)

---

## 4) “Exact code from main project” (no copies)

The harness should import the component directly from the project.

### Approach
- Use Vite’s `import.meta.glob` inside the harness bundle to map component modules.

Example concept:
- Discover components in `src/components/**/*.{tsx,jsx}`
- Address them by a stable key (file path + export name).

**Key point:** The preview must run through the same bundler config, aliases, and environment as the main project.

---

## 5) Sizing: stop relying on `fit-content`

Your doc already identified the issue:
- `fit-content` breaks `width: 100%` layouts.
- early measurement is wrong until fonts load.

### Recommended sizing model

**A) Fixed “measurement viewport width”**
- Each preview renders inside a container with a known width (e.g., 900px for hero).
- This ensures responsive components are comparable and `w-full` behaves.

**B) Height is measured**
- Let the component flow to its natural height.
- Measure height using `ResizeObserver`.

**C) Parent sets iframe size**
- Parent receives `{width,height}` from harness and sets iframe style accordingly.

**D) Two preview modes (optional)**
- **Fixed width mode**: use `measureWidth` for consistent comparison.
- **Responsive mode**: match canvas zoomed viewport width (advanced).

---

## 6) Interaction: “Navigate mode” vs “Interact mode” (required)

You can’t have perfect pan/zoom AND perfect interaction at the same time without a mode.

### Default: Navigate mode
- Parent overlay captures pointer + wheel.
- Iframes have `pointer-events: none`.

### Interact mode (per selected component)
- Disable the navigation overlay for that component’s bounds.
- Set that iframe `pointer-events: auto`.
- Focus the iframe.
- Provide `Esc` to exit.

### Recommended UX
- **Hold Space = navigate** (temporary)
- **Double-click** preview = enter interact
- **Esc** = exit interact

This feels very “Figma-like” and avoids accidental clicks while panning.

---

## 7) Parent ↔ Harness message protocol

Use a single channel with a handshake so you can safely manage many iframes.

### From harness → parent
- `CANVAS_READY { id, capabilities }`
- `CANVAS_SIZE { id, width, height, dpr }`
- `CANVAS_ERROR { id, message, stack? }`

### From parent → harness
- `CANVAS_INIT { id, componentKey, exportName, props, measureWidth }`
- `CANVAS_SET_PROPS { id, props }`
- `CANVAS_SET_MODE { id, mode: "fixed"|"responsive", measureWidth? }`
- `CANVAS_PING { id }` (optional health)

**IDs**
- The parent assigns an `id` per preview and passes it as query string or via `CANVAS_INIT`.
- The harness includes the `id` in all outgoing messages.

**Security**
- Use same-origin if possible.
- If not, validate `event.origin` and keep an allowlist.

---

## 8) Canvas visuals: show only pixels + minimal selection UI

### Default state
- No border, no title bar, no padding.
- The component appears as its real rendered output.

### On hover/selection (parent-drawn)
- Subtle outline (1px)
- Optional: tiny label (component name) floating above
- Optional: quick actions (Interact, Duplicate, Remove)

All of these are drawn by the parent overlay layer, not inside the iframe.

---

## 9) Layout stability (avoid overlap/jump)

If you auto-place components in a grid, measurements arrive asynchronously.

### Robust pattern
- Place items using an initial estimate.
- When `CANVAS_SIZE` arrives, run a layout pass.
- Animate position transitions (150–250ms) to hide jumps.

### Pinned vs auto (optional)
- Once user drags a component, mark it pinned and stop auto-reflowing it.

---

## 10) Performance notes (important as you scale)

- **Virtualize** if you render lots of previews:
  - Only mount iframes that are visible in the viewport (+ small buffer).
- **Throttle** `CANVAS_SIZE` messages:
  - `ResizeObserver` can be chatty. Use requestAnimationFrame or 50ms throttle.
- Prefer **one preview server origin** (same Vite server) for simpler messaging and caching.

---

## 11) Implementation checklist (sequence)

### Phase 1 — Make pixels-only previews
- [ ] Remove any wrapper UI from inside iframe/harness.
- [ ] Make harness background transparent and `body` margin 0.
- [ ] Move title/path/buttons to parent overlay UI.

### Phase 2 — Ensure fidelity
- [ ] Copy relevant `<head>` resources from `index.html` into harness HTML.
- [ ] Validate fonts + theme match main.

### Phase 3 — Robust sizing
- [ ] Add `document.fonts.ready` wait + `ResizeObserver`.
- [ ] Parent sets iframe size from reported dimensions.
- [ ] Add fixed measurement width for consistent previews.

### Phase 4 — Interaction modes
- [ ] Implement Navigate vs Interact mode.
- [ ] Space/Double-click/Esc behavior.
- [ ] Ensure focus is correct when entering interact.

### Phase 5 — Stability + polish
- [ ] Layout reflow animation.
- [ ] Persistence keyed by componentKey + project signature.
- [ ] Virtualization if you expect many previews.

---

## 12) Acceptance tests

1. **Visual match**
   - A component using project fonts renders identically in:
     - normal app route
     - canvas harness route

2. **No chrome**
   - In grid mode, components appear without borders/titles unless selected.

3. **Interact**
   - In interact mode: type into input, click button, open dropdown.
   - In navigate mode: pan/zoom works and clicks do not trigger component actions.

4. **Sizing**
   - Component that uses `w-full` renders correctly at fixed measure width.
   - Component resizes (e.g., async content) updates canvas size smoothly.

---

## 13) Optional future upgrades (still iframe-based)

- **Hover/selection overlay inside iframe (instrumented)**
  - Harness reports hovered element rects to parent for “Figma-ish” highlight.
- **Snapshot thumbnails**
  - Use `toDataURL` via `html2canvas`-like approach inside harness (or Playwright) for faster grid browsing.
- **Compare mode**
  - Lock all previews to the same measureWidth and aligned top/left for pixel-level comparison.

---

## Summary

To deliver what you want with iframes:
- Make the iframe render **only the component pixels** (no wrapper UI).
- Make the harness **clone `index.html` head** so it matches main.
- Use **fonts-ready + ResizeObserver** to report correct size.
- Use **Navigate vs Interact modes** so it’s both canvas-friendly and fully interactive.
- Draw any UI chrome (labels, outlines, buttons) **in the parent overlay**, not in the preview.

