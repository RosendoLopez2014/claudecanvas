# Development Guide

## Prerequisites

- **Node.js 20+** and **npm 10+**
- **Python 3** (for node-gyp, used by node-pty native build)
- **Xcode Command Line Tools** (macOS) or **Visual Studio Build Tools** (Windows)

## Setup

```bash
git clone https://github.com/your-org/claude-canvas.git
cd claude-canvas
npm install
npm run rebuild    # Rebuild node-pty for your Electron version
cp .env.example .env   # Optional: fill in OAuth credentials
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start electron-vite dev with HMR |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run rebuild` | Rebuild native modules (node-pty) |
| `npm test` | Run vitest test suite |
| `npm run test:watch` | Run vitest in watch mode |

## Build System

The project uses **electron-vite 3** configured in `electron.vite.config.ts`:

- **Main process**: Externalized deps except `electron-store`, `conf`, `@modelcontextprotocol/sdk`. `node-pty` is external (native module).
- **Preload**: All deps externalized.
- **Renderer**: React + Tailwind CSS plugins. `@` alias resolves to `src/renderer/`.

## Project Structure

```
src/
├── main/                    # Main process (Node.js)
│   ├── index.ts             # App entry, window creation, IPC registration
│   ├── pty.ts               # PTY spawn/kill with SIGTERM→SIGKILL escalation
│   ├── watcher.ts           # Chokidar file watching (function-based ignore)
│   ├── inspector.ts         # Inspector overlay injection into canvas iframe
│   ├── render-router.ts     # Evaluate inline vs canvas rendering
│   ├── screenshot.ts        # Viewport capture and checkpoint screenshots
│   ├── store.ts             # electron-store schema and handlers
│   ├── validate.ts          # isValidPath() for IPC input validation
│   ├── devserver/           # Dev server lifecycle
│   │   ├── index.ts         # Setup and IPC handlers
│   │   ├── runner.ts        # Process spawn, URL detection, crash loop
│   │   ├── resolve.ts       # Framework-aware command/port resolution
│   │   └── config-store.ts  # Per-project dev server config overrides
│   ├── mcp/                 # MCP bridge
│   │   ├── server.ts        # Express SSE server with session TTL
│   │   ├── tools.ts         # MCP tool definitions (canvas, gallery, etc.)
│   │   ├── config-writer.ts # Write/remove .mcp.json for Claude Code
│   │   └── gallery-state.ts # Gallery IPC handlers
│   ├── oauth/               # OAuth integrations
│   │   ├── github.ts        # Device flow
│   │   ├── vercel.ts        # PKCE flow
│   │   └── supabase.ts      # PKCE flow with compound tokens
│   └── services/
│       ├── git.ts           # Git operations (simple-git wrapper)
│       ├── dev-server.ts    # Legacy dev server handlers (being migrated)
│       ├── secure-storage.ts # Encrypted token storage (safeStorage API)
│       ├── templates.ts     # Project scaffolding
│       ├── worktree.ts      # Git worktree management
│       ├── framework-detect.ts # Detect project framework
│       ├── file-tree.ts     # Directory tree for file explorer
│       ├── search.ts        # Full-text project search
│       └── visual-diff.ts   # Pixel comparison for screenshots
│
├── preload/
│   └── index.ts             # Typed contextBridge — THE IPC contract
│
├── renderer/
│   ├── App.tsx              # Root: screen routing + global hooks
│   ├── main.tsx             # React DOM entry
│   ├── env.d.ts             # Type declarations (window.api)
│   ├── components/
│   │   ├── Canvas/          # CanvasPanel, ConsoleOverlay, DeployLog, etc.
│   │   ├── Terminal/        # TerminalView (xterm.js), InlineRender
│   │   ├── Gallery/         # Design gallery with variant comparison
│   │   ├── TabBar/          # Tab bar + new tab menu
│   │   ├── TitleBar/        # Custom frameless title bar
│   │   ├── StatusBar/       # Git status, service icons, push, token gauge
│   │   ├── Onboarding/      # Wizard + ProjectPicker
│   │   ├── CheckpointTimeline/ # Git-backed timeline with screenshots
│   │   ├── DiffView/        # Before/after file diff
│   │   ├── Settings/        # Settings panel, env editor, permissions
│   │   ├── Search/          # Project-wide search panel
│   │   ├── FileExplorer/    # File tree panel
│   │   ├── CommandPicker/   # Command palette (Cmd+K)
│   │   ├── ShortcutSheet/   # Keyboard shortcuts overlay
│   │   ├── QuickActions/    # Quick action palette
│   │   ├── ServiceIcons/    # GitHub/Vercel/Supabase status dropdowns
│   │   ├── Toast/           # Toast notifications
│   │   └── Workspace/       # Main workspace layout (split panes)
│   ├── hooks/
│   │   ├── usePty.ts        # PTY spawn/write/resize lifecycle
│   │   ├── useInspector.ts  # Inspector overlay communication
│   │   ├── useFileWatcher.ts # File change event handling
│   │   ├── useGitSync.ts    # Periodic git fetch + ahead/behind sync
│   │   ├── useMcpCommands.ts # MCP event → state update routing
│   │   ├── useMcpStateExposer.ts # Expose renderer state to MCP
│   │   ├── useKeyboardShortcuts.ts # Global keyboard shortcuts
│   │   ├── useAutoCheckpoint.ts # Automatic git checkpointing
│   │   ├── useDevServerSync.ts # Dev server status sync across tabs
│   │   ├── useTabState.ts   # Tab-aware state selectors
│   │   ├── useRenderRouter.ts # Inline vs canvas rendering decision
│   │   └── useTokenTracking.ts # Token usage tracking
│   ├── stores/
│   │   ├── tabs.ts          # CANONICAL: all per-tab state
│   │   ├── project.ts       # Current project + screen routing
│   │   ├── gallery.ts       # Gallery variants + design sessions
│   │   ├── canvas.ts        # Canvas tab types
│   │   ├── terminal.ts      # Terminal theme
│   │   ├── workspace.ts     # Layout mode
│   │   └── toast.ts         # Toast queue
│   └── services/
│       └── terminalPool.ts  # Terminal instance pooling
│
├── inspector/               # Injected into canvas iframe
│   ├── overlay.ts           # Mouse tracking, highlight, click selection
│   ├── fiber-walker.ts      # React fiber tree → component name + source
│   └── style-extractor.ts   # Computed style extraction
│
└── shared/
    ├── constants.ts          # Shared constants (thresholds, timeouts, presets)
    └── devserver/
        └── types.ts          # Dev server shared types
```

## Key Patterns

### IPC Communication

All renderer↔main communication goes through the typed preload bridge in `src/preload/index.ts`. Never bypass this:

```typescript
// Renderer side — always use window.api.*
const id = await window.api.pty.spawn('/bin/zsh', '/path/to/project')

// Main side — register handlers in setup functions
ipcMain.handle('pty:spawn', (_event, shell, cwd) => { ... })
```

See [IPC Reference](IPC-REFERENCE.md) for the complete API.

### State Management

Use Zustand stores, never Redux or React Context for app state:

```typescript
// Reading state in components
const activeTab = useTabsStore((s) => s.getActiveTab())

// Updating state
useTabsStore.getState().updateTab(tabId, { previewUrl: url })

// Reading state outside React
const tab = useTabsStore.getState().getActiveTab()
```

The **tabs store is the single source of truth** for all per-tab state. When adding new per-tab features, add fields to `TabState` in `stores/tabs.ts`.

### Adding a New IPC Channel

1. Add the handler in the appropriate main-process module
2. Register it in `src/main/index.ts` (or in the module's `setup*()` function)
3. Add the typed API in `src/preload/index.ts`
4. Call it from the renderer via `window.api.*`

### Adding a New Component

1. Create a directory under `src/renderer/components/YourComponent/`
2. If it needs per-tab state, add fields to `TabState` in `stores/tabs.ts`
3. If it needs IPC, follow the IPC pattern above
4. Wire it into `Workspace.tsx` or `App.tsx` as appropriate

### Debug Flag

Gate noisy logs behind the `DEBUG` constant:

```typescript
import { DEBUG } from '../../shared/constants'
if (DEBUG) console.log('[subsystem] verbose info')
```

This evaluates to `true` in dev mode and `false` in production.

## Testing

Tests use **vitest** with **jsdom** environment and **@testing-library/react**.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Test files live in `__tests__/` directories adjacent to source:

- `src/renderer/__tests__/` — Store tests, API bridge tests, integration tests
- `src/inspector/__tests__/` — Fiber walker and style extractor tests

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest'

describe('MyFeature', () => {
  it('should do the thing', () => {
    // Test logic
  })
})
```

For store tests, import the store directly and call actions:

```typescript
import { useTabsStore } from '../stores/tabs'

it('creates a tab', () => {
  useTabsStore.getState().createTab({ name: 'test', path: '/tmp/test' })
  expect(useTabsStore.getState().tabs).toHaveLength(1)
})
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` | Command palette |
| `Cmd+T` | New tab |
| `Cmd+W` | Close tab |
| `Cmd+1-9` | Switch to tab N |
| `Cmd+Shift+]` / `Cmd+Shift+[` | Next/previous tab |
| `Cmd+,` | Settings |
| `Cmd+F` | Search in project |
| `Cmd+Shift+G` | Toggle gallery |
| `Cmd+Shift+V` | Toggle canvas |
| `Cmd+/` | Shortcut sheet |
| `Cmd+Option+I` | DevTools |

## Styling

- **Tailwind CSS 4** — utility-first, configured via `@tailwindcss/vite` plugin
- **Dark theme** — background `#0A0F1A`, surface colors via CSS custom properties
- **Accent colors** — Cyan `#4AEAFF`, Coral `#FF6B4A`
- **Framer Motion** — for panel transitions and animations
- **Radix UI** — for dropdowns, tooltips, tabs
