# Architecture

Claude Canvas is an Electron app built with electron-vite 3. It follows Electron's multi-process architecture with strict context isolation between the main and renderer processes.

## Process Model

```
┌──────────────────────────────────────────────────────────┐
│                    Main Process (Node.js)                 │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  PTY    │  │  File    │  │   Git    │  │  OAuth  │  │
│  │ Manager │  │ Watcher  │  │ Service  │  │ Flows   │  │
│  └─────────┘  └──────────┘  └──────────┘  └─────────┘  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  Dev    │  │  MCP     │  │Inspector │  │ Secure  │  │
│  │ Server  │  │ Bridge   │  │ Injector │  │ Storage │  │
│  └─────────┘  └──────────┘  └──────────┘  └─────────┘  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │Templates│  │ Search   │  │File Tree │  │ Screen- │  │
│  │Scaffold │  │ Service  │  │ Service  │  │  shot   │  │
│  └─────────┘  └──────────┘  └──────────┘  └─────────┘  │
└───────────────────────┬──────────────────────────────────┘
                        │ IPC (contextBridge)
┌───────────────────────┴──────────────────────────────────┐
│                  Preload (src/preload/index.ts)           │
│             Typed API exposed via contextBridge           │
└───────────────────────┬──────────────────────────────────┘
                        │ window.api.*
┌───────────────────────┴──────────────────────────────────┐
│                   Renderer Process (React 19)             │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                    App.tsx                         │    │
│  │  Screen routing: onboarding → project-picker →    │    │
│  │  workspace (TabBar + Workspace + StatusBar)       │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │Terminal │  │  Canvas  │  │ Gallery  │  │Timeline │  │
│  │  View   │  │  Panel   │  │  View    │  │  View   │  │
│  └─────────┘  └──────────┘  └──────────┘  └─────────┘  │
│  ┌──────────────────────────────────────────────────┐    │
│  │              Zustand Stores                       │    │
│  │  tabs · project · gallery · canvas · terminal ·   │    │
│  │  workspace · toast                                │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## Main Process Services

Each service is a standalone module that registers IPC handlers on startup in `src/main/index.ts`:

| Service | File | Responsibility |
|---|---|---|
| PTY Manager | `pty.ts` | Spawn/kill shells, buffer output, SIGTERM→SIGKILL escalation |
| File Watcher | `watcher.ts` | Chokidar-based file watching with FD-aware ignore rules |
| Dev Server | `devserver/` | Start/stop dev servers, detect URLs, crash loop protection |
| Git | `services/git.ts` | Status, branch, commit, push, pull, PR, diff, rollback |
| GitHub OAuth | `oauth/github.ts` | Device flow, repo creation, PR status |
| Vercel OAuth | `oauth/vercel.ts` | PKCE flow, projects, deployments, build logs |
| Supabase OAuth | `oauth/supabase.ts` | PKCE flow, tables, SQL, functions, storage |
| MCP Bridge | `mcp/` | SSE-based MCP server for Claude Code tool integration |
| Inspector | `inspector.ts` | Inject overlay scripts into canvas iframe |
| Secure Storage | `services/secure-storage.ts` | Encrypt/decrypt OAuth tokens via OS keychain |
| Templates | `services/templates.ts` | Project scaffolding (React, Next.js, etc.) |
| Worktrees | `services/worktree.ts` | Git worktree management for multi-branch tabs |
| Settings | `store.ts` | electron-store for persistent settings |
| Render Router | `render-router.ts` | Evaluate component size → inline vs canvas |
| Screenshot | `screenshot.ts` | Capture viewport regions and checkpoint screenshots |
| Search | `services/search.ts` | Full-text search across project files |
| File Tree | `services/file-tree.ts` | Directory tree for file explorer |
| Visual Diff | `services/visual-diff.ts` | Pixel-level image comparison |
| Path Validation | `validate.ts` | Shared `isValidPath()` for IPC input validation |

## State Management

All renderer state lives in **Zustand stores** (never Redux, never React Context for app state).

### Store Architecture

```
useTabsStore (canonical)
├── tabs: TabState[]           # Array of open tabs
├── activeTabId: string        # Currently active tab
└── getActiveTab()             # Helper to get active tab state

Each TabState contains:
├── project: ProjectInfo       # Name, path, framework
├── ptyId: string              # PTY process ID
├── dev: DevServerState        # Dev server status, URL, errors
├── previewUrl: string         # Canvas preview URL
├── activeCanvasTab: CanvasTab # Which canvas sub-tab is active
├── galleryVariants: []        # Gallery state
├── git*: ...                  # Git sync state (ahead/behind/etc.)
├── worktree*: ...             # Worktree branch info
├── mcp*: ...                  # MCP readiness
└── *Bootstrapped: boolean     # Service connection flags
```

The **tabs store is canonical** — it holds all per-tab state. Other stores provide cross-cutting concerns:

| Store | Purpose |
|---|---|
| `tabs.ts` | All per-tab state (PTY, dev server, canvas, git, services) |
| `project.ts` | Current project info + screen routing (onboarding/picker/workspace) |
| `gallery.ts` | Gallery variants, design sessions, persistence |
| `canvas.ts` | Canvas tab types and element context types |
| `terminal.ts` | Terminal theme configuration |
| `workspace.ts` | Layout mode (terminal-only, split, canvas-only) |
| `toast.ts` | Toast notification queue |

### Tab Lifecycle

1. User opens a project → `createTab()` adds a `TabState` to the store
2. Workspace renders the active tab's `TerminalView` + `CanvasPanel`
3. PTY spawns with `window.api.pty.spawn()`, ID stored in `TabState.ptyId`
4. Switching tabs updates `activeTabId` — old PTY keeps running, new tab's PTY resumes
5. Closing a tab kills its PTY and cleans up dev server / file watcher
6. Tabs persist to `electron-store` and restore on next launch

## Data Flows

### File Change → Preview Update

```
1. User edits code (via Claude Code in terminal)
2. chokidar detects change → sends fs:change to renderer
3. useFileWatcher hook receives event
4. If dev server running → iframe reloads automatically (HMR)
5. If gallery active → re-renders affected variants
```

### MCP Bridge Flow

```
1. Workspace mounts → renderer calls mcp:project-opened
2. Main process starts Express SSE server on random port
3. Writes .mcp.json to project root (so Claude Code discovers it)
4. Claude Code connects via SSE, calls MCP tools:
   - canvas_preview → renders HTML in canvas panel
   - add_to_gallery → adds variant to design gallery
   - start_preview → starts dev server
   - checkpoint → creates git checkpoint
5. MCP tool results sent to renderer via IPC events (mcp:canvas-render, etc.)
6. Renderer hooks (useMcpCommands) apply state updates to active tab
```

### Inspector Click → Context Paste

```
1. User clicks element in canvas iframe
2. Injected overlay script captures: tag, classes, computed styles
3. fiber-walker.ts walks React fiber tree → finds component name + source file
4. style-extractor.ts extracts key CSS properties
5. postMessage sends context to parent (validated origin)
6. useInspector hook receives context
7. Context block auto-pasted into terminal as Claude Code input
```

### OAuth Flow (GitHub example)

```
1. User clicks GitHub icon in status bar
2. Renderer calls oauth:github:requestCode
3. Main process starts device flow → returns user_code
4. User enters code at github.com/login/device
5. Main process polls for token
6. Token encrypted via safeStorage → stored in encryptedTokens
7. Status bar updates to show connected state
```

## App Initialization Order

On `app.whenReady()` in `src/main/index.ts`:

1. Log FD baseline for diagnostics
2. Instrument IPC handlers with slow-call logging (>50ms)
3. `initSecureStorage()` — migrate plaintext tokens to encrypted storage
4. `createWindow()` — frameless BrowserWindow with context isolation
5. Register all IPC handlers (PTY, settings, watcher, dev server, git, OAuth, etc.)
6. MCP server starts when first project opens (lazy, not at boot)

## App Shutdown

On `window-all-closed`:

1. Remove MCP config files (.mcp.json)
2. Stop MCP server
3. Kill all PTYs (SIGTERM → 1s → SIGKILL)
4. Close all file watchers
5. Kill all dev servers
6. Clean up git instances

## Key Design Decisions

1. **Electron over Tauri** — Full Chromium needed for iframe inspector injection + node-pty native support
2. **iframe over webview** — Same-origin access to localhost for direct DOM manipulation
3. **Terminal-first layout** — Canvas is contextual, not permanent. Terminal is always the primary surface.
4. **Zustand over Redux** — Surgical state updates prevent cross-component re-renders
5. **WebGL xterm addon** — 5-10x faster terminal rendering vs Canvas2D
6. **electron-vite over webpack** — Sub-100ms HMR in development
7. **Context isolation ON** — All IPC through typed preload bridge (security requirement)
8. **Tabs store is canonical** — Single source of truth for all per-tab state avoids sync bugs
