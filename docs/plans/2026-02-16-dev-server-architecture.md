# Dev Server Architecture: Current State, Gaps, and Vision

## Vision

**One-click start for any project.** The user opens a project, clicks Start, and the correct dev server runs — regardless of framework, package manager, or custom scripts. Multiple projects run simultaneously across tabs with independent lifecycle management. Stopping, crashing, and restarting are all handled cleanly per-tab.

---

## Current Architecture

### Request Flow

```
StatusBar "Start" button
  → startApp()                                    [StatusBar.tsx:155]
  → window.api.dev.start(projectPath, devCommand) [preload/index.ts:272]
  → ipcMain.handle('dev:start', cwd, command)     [dev-server.ts:203]
  → startServer(cwd, cmd, getWindow)              [dev-server.ts:123]
  → spawn(bin, args, { shell: true, cwd })        [dev-server.ts:144]
  → monitor stdout for localhost URL regex         [dev-server.ts:135,156]
  → return { url, pid } to renderer
  → StatusBar sets state + opens Canvas iframe
```

### Main Process (dev-server.ts) — Per-Project, Works Correctly

Three maps track server lifecycle, all keyed by project `cwd`:

```
devProcesses = Map<cwd, ChildProcess>   // running server processes
devUrls      = Map<cwd, string>         // detected localhost URLs
startingCwds = Set<cwd>                 // guard against concurrent starts
```

| IPC Handler | Purpose |
|---|---|
| `dev:start(cwd, command?)` | Spawn server, detect URL, return result |
| `dev:stop(cwd?)` | Kill process tree (one project, or all on shutdown) |
| `dev:status(cwd)` | Query if server is running + its URL |

**Self-healing retry loop** (3 attempts max):
- `EBADF` → wait 500ms, retry
- `missing-deps` → auto-detect package manager (yarn/pnpm/npm), run install, retry
- `port-in-use` → `lsof` + `kill -9`, retry

**URL detection**: Regex `https?:\/\/(?:localhost|127\.0\.0\.1):\d+` against stdout + stderr. Times out after 20 seconds (`DEV_SERVER_STARTUP_TIMEOUT_MS`).

**Environment**: `getShellEnv()` prepends Homebrew, nvm, volta, fnm paths to `PATH` (Electron GUI launches have minimal PATH). Sets `BROWSER=none` to prevent auto-open.

**Process cleanup**: `treeKill(pid, SIGTERM)` kills the entire process tree (server + child workers). On tab close, `cleanupTabResources()` calls `dev.stop(tab.project.path)`.

### Framework Detection (framework-detect.ts) — Exists, Not Wired Up

Reads `package.json`, scans dependencies for known frameworks, and returns `{ framework, devCommand, devPort }`:

| Framework | Package Marker | Default Command | Port |
|---|---|---|---|
| Next.js | `next` | `npm run dev` | 3000 |
| Nuxt | `nuxt` | `npm run dev` | 3000 |
| Remix | `@remix-run/react` | `npm run dev` | 5173 |
| Astro | `astro` | `npm run dev` | 4321 |
| SvelteKit | `@sveltejs/kit` | `npm run dev` | 5173 |
| Vite | `vite` | `npm run dev` | 5173 |
| Gatsby | `gatsby` | `npm run develop` | 8000 |
| CRA | `react-scripts` | `npm start` | 3000 |
| Angular | `@angular/core` | `npm start` | 4200 |
| Vue | `vue` | `npm run dev` | 5173 |
| Generic Node | _(has scripts)_ | `npm run dev` or `npm start` | 3000 |

**Smart override**: If `package.json` has a `dev` script, uses `npm run dev`; else if `start`, uses `npm start`; else if `develop`, uses `npm run develop`.

Exposed to renderer as `window.api.framework.detect(path)` but **never called from project opening flow**.

### Renderer State — Three Conflicting Layers (Broken)

| Layer | Store | Scope | Who Reads | Who Writes |
|---|---|---|---|---|
| `useProjectStore().isDevServerRunning` | project.ts | **Global** | StatusBar | StatusBar |
| `useCanvasStore().previewUrl` | canvas.ts | **Global** | StatusBar | StatusBar, useMcpCommands |
| `tab.isDevServerRunning` / `tab.previewUrl` | tabs.ts | **Per-tab** | CanvasPanel | CanvasPanel (HMR recovery only) |

Both global fields are marked `@deprecated` with "use tabs store instead" comments, but StatusBar still reads/writes the deprecated globals.

### Settings

Settings.tsx has a "Dev Command" text input under the Terminal tab. It stores a single global `devCommand` string. It is **never read** by `startApp()` — the StatusBar only reads `currentProject.devCommand`, which comes from `ProjectInfo` in the project store.

---

## Identified Bugs

### Bug 1: `dev:exit` Ignores Which Project Exited

```typescript
// StatusBar.tsx:114
window.api.dev.onExit(({ cwd: _cwd, code: _code }) => {
  setDevServerRunning(false)   // ← writes GLOBAL state
  setPreviewUrl(null)          // ← writes GLOBAL state
})
```

**Impact**: If Project A's server crashes while viewing Project B, B's button flips to "Start" even though B's server is still running.

### Bug 2: `dev:status` Events Are Unfiltered

```typescript
// StatusBar.tsx:124
window.api.dev.onStatus((status) => { ... })
```

Status events from *any* project's dev server update the *current* StatusBar. Starting Project B while on Tab A shows "Starting..." on A.

### Bug 3: Start/Stop Write to Global Store

```typescript
// StatusBar.tsx:165
setDevServerRunning(true)    // useProjectStore — global
setPreviewUrl(result.url)    // useCanvasStore — global
```

Starting/stopping always overwrites global state regardless of which tab initiated it.

### Bug 4: Tab Switch Doesn't Restore Dev Server State

When switching from Tab A (server running) to Tab B (no server), the StatusBar shows whatever global `isDevServerRunning` was last set to. No reconciliation with tab-level state or main process truth.

### Bug 5: No Framework Detection on "Open Existing"

```typescript
// ProjectPicker.tsx:62-66
const openExisting = useCallback(async () => {
  const dir = await window.api.dialog.selectDirectory()
  if (!dir) return
  const name = dir.split('/').pop() || 'project'
  openProject({ name, path: dir })  // ← no framework, no devCommand
})
```

`devCommand` is `undefined`, so `dev:start` falls back to hardcoded `"npm run dev"`. Projects using `npm start`, `yarn dev`, or custom scripts fail.

### Bug 6: useMcpCommands Double-Writes

```typescript
// useMcpCommands.ts:124,139
useCanvasStore.getState().setPreviewUrl(url)       // global
useProjectStore.getState().setDevServerRunning(true) // global
updateTargetTab(eventPath, { previewUrl: url, ... }) // per-tab
```

MCP `canvas_start_preview` writes to both deprecated globals and tab store, creating drift.

### Bug 7: Settings devCommand Is Orphaned

The Settings "Dev Command" input saves to `settings.devCommand` but nothing reads it. `startApp()` reads `currentProject.devCommand`. There's no bridge between the two.

---

## Multi-Project Scenario (What Happens Today)

1. Open Tab A (Project A), click Start → server starts, global `isDevServerRunning=true`
2. Open Tab B (Project B), click Start → server starts, global `isDevServerRunning=true`
3. Switch to Tab A → shows "Stop" (global is true), but `previewUrl` might show B's URL
4. Project A crashes → `dev:exit` fires → global flips to `false`
5. Switch to Tab B → shows "Start" button even though B's server is running in main
6. Click Start → error "Dev server already running for this project"

---

## Vision: One-Click Start, Clean Multi-Project Lifecycle

### Principle 1: Tab Store Is the Single Source of Truth

All dev server state lives in `TabState`. The deprecated globals in `project.ts` and `canvas.ts` are removed. StatusBar reads from `useTabState()`.

### Principle 2: Events Are Filtered by Project Path

`dev:exit`, `dev:output`, and `dev:status` events from main include `cwd`. The renderer matches `cwd` to the correct tab and updates only that tab's state. Events for the active tab also update the UI immediately.

### Principle 3: Auto-Detect on Project Open

When any project is opened (existing folder, recent project, scaffolded), `framework.detect(path)` runs and populates `ProjectInfo.devCommand`. The user never needs to configure anything.

### Principle 4: Command Resolution Priority

When Start is clicked, the command resolves through this chain:

```
1. Per-project override (if user set one in project settings)
2. ProjectInfo.devCommand (populated by framework detection)
3. Settings global devCommand (if user configured a default)
4. Auto-detect at start time (re-run framework detection)
5. Fallback: "npm run dev"
```

### Principle 5: Tab Switch Reconciles with Main Process

On tab switch, query `dev:status(tab.project.path)` to reconcile renderer state with main process truth. This handles edge cases like servers crashing while on a different tab.

### Principle 6: Clean Lifecycle Events

```
Tab Open     → framework detect → populate devCommand
Start Click  → resolve command → spawn → detect URL → update tab state
Tab Switch   → reconcile dev:status → update button/preview
Server Crash → dev:exit(cwd) → find matching tab → update that tab only
Tab Close    → cleanupTabResources → dev:stop → kill process tree
App Quit     → killDevServer → kill all process trees
```

### Principle 7: Package Manager Awareness

Command detection should respect the project's package manager:

| Lock File | Manager | Command Prefix |
|---|---|---|
| `yarn.lock` | yarn | `yarn dev` |
| `pnpm-lock.yaml` | pnpm | `pnpm run dev` |
| `bun.lockb` | bun | `bun run dev` |
| `package-lock.json` / none | npm | `npm run dev` |

The framework detector already checks scripts but always prefixes with `npm`. It should use the detected package manager.

### Principle 8: Fallback URL Detection

If stdout URL detection times out, fall back to:

1. Check the detected `devPort` from framework detection
2. Probe `localhost:{port}` with HTTP requests
3. If reachable, use that URL

This handles servers that don't print their URL to stdout (custom Express servers, Python backends, etc.).

---

## Files Involved

| File | Role | Changes Needed |
|---|---|---|
| `src/main/services/dev-server.ts` | Process spawn, retry, lifecycle | Minor: package manager prefix |
| `src/main/services/framework-detect.ts` | Read package.json, detect framework | Add bun, package manager detection |
| `src/renderer/components/StatusBar/StatusBar.tsx` | Start/Stop button, status display | Major: migrate to tab state, filter events |
| `src/renderer/components/Canvas/CanvasPanel.tsx` | Preview iframe, HMR recovery | Minor: already uses tab state |
| `src/renderer/components/Onboarding/ProjectPicker.tsx` | Open existing projects | Add framework detection call |
| `src/renderer/hooks/useMcpCommands.ts` | MCP canvas_start_preview | Remove deprecated global writes |
| `src/renderer/stores/tabs.ts` | Per-tab state | Already has fields, just needs writers |
| `src/renderer/stores/project.ts` | Global project state | Remove deprecated dev server fields |
| `src/renderer/stores/canvas.ts` | Global canvas state | Remove deprecated previewUrl |
| `src/renderer/components/Settings/Settings.tsx` | Global dev command setting | Wire to command resolution chain |
| `src/preload/index.ts` | IPC bridge | No changes needed |
