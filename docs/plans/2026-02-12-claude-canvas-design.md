# Claude Canvas — Design Document

**Date:** 2026-02-12
**Status:** Approved

## Vision

Claude Canvas is a terminal-first Electron development environment where Claude Code is the primary interface. Visual output renders adaptively — small components appear inline in the terminal as interactive HTML, while full pages and running apps open in a right-side canvas panel with an element inspector.

## Core Concept: Terminal-First with Adaptive Rendering

The terminal is always home. The canvas materializes only when there's something to show, and it sizes itself to the content.

### Rendering Rules

| Content Size | Render Target | Example |
|---|---|---|
| Small (< ~400x200px) | Inline in terminal output | Buttons, icons, badges, small cards |
| Large / full page | Right canvas panel | Full page layouts, dashboards, forms |
| Dev server running | Right canvas panel (persistent) | localhost:3000 with inspector overlay |

### Workspace States

**State 1 — Terminal Only** (default)
- Terminal takes 100% width
- No canvas visible
- User interacts with Claude Code CLI

**State 2 — Terminal + Inline Renders**
- Terminal still 100% width
- Small components render as interactive HTML islands embedded in terminal output
- Inline renders are live, clickable, styled — not screenshots
- Implemented as mini sandboxed iframes within the terminal output stream

**State 3 — Terminal + Right Canvas**
- Terminal shrinks to left side (~40-50%)
- Right canvas panel appears for full preview
- Inspector overlay available on canvas
- Split pane is resizable (allotment)

**State 4 — Mixed**
- Terminal on left with inline renders in output
- Right canvas showing running app or large component
- Both render targets active simultaneously

## User Workflow

### First Launch — Onboarding Wizard
1. Set default project storage directory
2. Theme preference (dark default)
3. Optional service logins: GitHub, Vercel, Supabase
4. Create or open first project
5. Subsequent launches skip to project picker

### Project Picker (subsequent launches)
- Recent projects grid with thumbnails
- "New Project" button — name, template, framework selection
- "Open Existing" — system file picker
- No terminal commands needed for project management

### Core Loop
1. User opens project → terminal appears (full width) with Claude Code running
2. User types prompts in Claude Code (the terminal IS the chat)
3. Claude generates code → file watcher detects changes
4. Smart router evaluates render size:
   - Small component → inline render in terminal
   - Large component / page → right canvas panel opens
5. User can click elements in canvas → inspector activates → context auto-pastes into terminal
6. User types follow-up prompt with context → Claude modifies → live update
7. Repeat

### Inspector Interaction
- Available only on the right canvas panel (not inline renders)
- Hover: highlight element with blue overlay + tooltip (tag, class, component name)
- Click: select element → auto-paste context block into terminal containing:
  - Component name and file path
  - Key CSS properties
  - React props (if available via fiber walking)
- User follows up with natural language instruction in terminal

## Architecture

### Electron Process Model

```
Main Process (Node.js)
├── node-pty (PTY management for Claude Code)
├── chokidar (file watching for render triggers)
├── electron-store (settings, tokens, project history)
├── simple-git (branch, status, diff operations)
├── OAuth handlers (GitHub, Vercel, Supabase)
├── Project manager (create, detect, start dev servers)
└── Render router (evaluate component size → inline vs canvas)

Preload (Secure IPC Bridge)
└── Typed contextBridge API for all IPC channels

Renderer Process (React 19 + Vite)
├── Terminal view (xterm.js + WebGL addon)
│   └── Inline render islands (sandboxed mini iframes)
├── Canvas panel (iframe to localhost or component render)
│   └── Inspector overlay (injected scripts)
├── Gallery view (component variants in isolated iframes)
├── Checkpoint timeline (git-based snapshots)
├── Diff view (before/after comparison)
├── Onboarding wizard
├── Project picker
├── Status bar
└── Quick actions bar
```

### IPC Channels

```
Terminal:
  pty:spawn, pty:write, pty:data:{id}, pty:resize, pty:kill

Canvas:
  canvas:elementSelected, canvas:writeContext, canvas:reload

File Watching:
  fs:watch, fs:change, fs:unwatch

Inline Rendering:
  render:evaluate (determine inline vs canvas)
  render:inline (send HTML to terminal inline block)
  render:canvas (send to right panel)

Inspector:
  inspector:activate, inspector:deactivate
  inspector:elementHovered, inspector:elementSelected

Project:
  project:create, project:open, project:list, project:detect
  project:startDev, project:stopDev

Git:
  git:status, git:branch, git:diff, git:checkpoint

OAuth:
  oauth:github, oauth:vercel, oauth:supabase
  oauth:status, oauth:logout

Gallery:
  gallery:renderVariants, gallery:select

Settings:
  settings:get, settings:set
```

### Inline Render System (Key Innovation)

When Claude Code generates a small component:

1. Chokidar detects file change in project
2. Main process evaluates the component:
   - Renders it in a hidden BrowserWindow
   - Measures the output dimensions
3. If dimensions < threshold (~400x200px):
   - Serializes the rendered HTML + styles
   - Sends via IPC to renderer
   - Renderer creates a sandboxed mini iframe in the terminal output
   - The iframe is interactive (clicks, hovers work)
4. If dimensions > threshold:
   - Opens or updates the right canvas panel
   - Loads the component in the canvas iframe

Implementation: xterm.js supports custom decorations via its decoration API. Inline renders are xterm decorations containing sandboxed iframes.

### Inspector Implementation

- Uses standard `<iframe>` (not `<webview>`) for same-origin localhost access
- Inspector overlay script injected into iframe via `contentDocument`
- React fiber walking via `__reactFiber$` DOM keys for component→source mapping
- MutationObserver for live DOM change detection
- ResizeObserver for element size tracking
- postMessage API for iframe↔parent communication
- Libraries to consider: react-dev-inspector, react-scan

### Canvas Panel Features

When the right canvas is open:

- **Preview tab**: Live iframe to dev server or component render
- **Gallery tab**: Component variants rendered in isolated iframes
- **Timeline tab**: Checkpoint snapshots (git-based) with visual diff
- **Diff tab**: Before/after visual comparison

## Tech Stack

### Main Process Dependencies
- node-pty ^1.0.0 — PTY management
- chokidar ^4.0.0 — File watching
- electron-store ^10.0.0 — Settings and token storage
- simple-git ^3.25.0 — Git operations
- detect-port ^2.1.0 — Find dev server port
- tree-kill ^1.2.2 — Clean process termination

### Renderer Dependencies
- react ^19.0.0, react-dom ^19.0.0
- @xterm/xterm ^5.5.0 — Terminal (with WebGL addon)
- @xterm/addon-webgl ^0.18.0 — GPU-accelerated rendering
- @xterm/addon-fit ^0.10.0 — Auto-resize
- @xterm/addon-unicode11 ^0.8.0 — Emoji support
- @xterm/addon-search ^0.15.0 — Terminal search
- @xterm/addon-serialize ^0.13.0 — State save/restore
- zustand ^5.0.0 — State management
- framer-motion ^12.0.0 — Animations
- lucide-react ^0.460.0 — Icons
- allotment ^1.20.0 — Split panes
- @radix-ui/react-dropdown-menu, react-tooltip, react-tabs — UI primitives

### Dev Dependencies
- electron ^33.0.0
- electron-vite ^3.0.0
- electron-builder ^25.0.0
- @electron/rebuild ^3.6.0
- typescript ^5.7.0
- tailwindcss ^4.0.0
- @tailwindcss/vite ^4.0.0
- vite ^6.0.0

## Project Structure

```
claude-canvas/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── CLAUDE.md
│
├── src/
│   ├── main/
│   │   ├── index.ts                 # App entry, window creation
│   │   ├── pty.ts                   # PTY management (node-pty)
│   │   ├── watcher.ts              # File watching (chokidar)
│   │   ├── render-router.ts        # Evaluate inline vs canvas
│   │   ├── project-manager.ts      # Create, open, detect projects
│   │   ├── oauth/
│   │   │   ├── github.ts
│   │   │   ├── vercel.ts
│   │   │   └── supabase.ts
│   │   ├── services/
│   │   │   ├── git.ts
│   │   │   └── dev-server.ts       # Start/stop dev servers
│   │   └── store.ts                # electron-store settings
│   │
│   ├── preload/
│   │   └── index.ts                # Typed IPC bridge
│   │
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── stores/
│   │   │   ├── terminal.ts
│   │   │   ├── canvas.ts
│   │   │   ├── project.ts
│   │   │   ├── services.ts
│   │   │   └── gallery.ts
│   │   ├── components/
│   │   │   ├── TitleBar/
│   │   │   ├── Terminal/
│   │   │   │   ├── TerminalView.tsx
│   │   │   │   └── InlineRender.tsx  # Sandboxed inline iframes
│   │   │   ├── Canvas/
│   │   │   │   ├── CanvasPanel.tsx
│   │   │   │   ├── Preview.tsx
│   │   │   │   ├── Inspector.tsx
│   │   │   │   └── Overlay.tsx
│   │   │   ├── Gallery/
│   │   │   ├── Onboarding/
│   │   │   │   ├── Wizard.tsx
│   │   │   │   └── ProjectPicker.tsx
│   │   │   ├── QuickActions/
│   │   │   ├── ServiceIcons/
│   │   │   ├── StatusBar/
│   │   │   ├── CheckpointTimeline/
│   │   │   └── DiffView/
│   │   ├── hooks/
│   │   │   ├── usePty.ts
│   │   │   ├── useInspector.ts
│   │   │   ├── useFileWatcher.ts
│   │   │   ├── useRenderRouter.ts
│   │   │   ├── useProject.ts
│   │   │   └── useOAuth.ts
│   │   └── styles/
│   │       └── globals.css
│   │
│   └── inspector/
│       ├── overlay.ts              # Element highlight/selection
│       ├── fiber-walker.ts         # React fiber -> source mapping
│       └── style-extractor.ts      # Computed style extraction
│
├── resources/
└── docs/
    └── plans/
```

## Design Decisions

1. **Electron over Tauri**: Full Chromium needed for iframe inspector injection + node-pty native support
2. **iframe over webview**: Same-origin access to localhost for direct DOM manipulation
3. **Terminal-first layout**: Canvas is contextual, not permanent. Terminal is always the primary surface.
4. **Inline renders via xterm decorations**: Small components render as interactive HTML islands in terminal output
5. **Zustand over Redux**: Surgical state updates prevent cross-component re-renders
6. **WebGL xterm addon**: 5-10x faster terminal rendering vs Canvas2D
7. **electron-vite over webpack**: Sub-100ms HMR in development
8. **Context isolation ON**: All IPC through typed preload bridge (security best practice)

## Visual Design

- Dark theme default
- Accent colors: Cyan #4AEAFF, Coral #FF6B4A
- Font: JetBrains Mono / Fira Code for terminal
- Glass/translucent effects for overlays
- Framer Motion animations for panel transitions
- Frameless window with custom title bar
