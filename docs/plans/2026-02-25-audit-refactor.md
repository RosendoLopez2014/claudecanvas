# Audit Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address all findings from the full codebase audit — eliminate dead stores, split god components/files, fix silent error handling, close performance gaps, and harden reliability. Zero functional changes.

**Architecture:** Refactoring-only. Every change is behavior-preserving. The app's UX, features, and user-facing behavior remain identical. We work bottom-up: types first, then stores, then consumers, then main-process splits, then performance.

**Tech Stack:** React 19, Zustand 5, TypeScript 5.7, Electron 33, xterm.js 5, chokidar 4, simple-git

**Verification:** After every task, run `npm test` and `npm run build` to confirm nothing breaks. The app should launch and behave identically.

---

## Phase 1: State Management Cleanup (Highest Impact)

The canvas store, terminal store, and project store all contain deprecated fields that duplicate `useTabsStore`. This is the root cause of dual-source-of-truth bugs and makes every new feature harder to build.

---

### Task 1: Extract shared types from canvas store

The canvas store exports types (`CanvasTab`, `ElementContext`, `PreviewError`, `ConsoleLogEntry`, `A11yInfo`, `ParentLayoutInfo`, `ViewportMode`) that are imported across ~20 files. Before we can delete the store, we need these types to live somewhere else.

**Files:**
- Create: `src/renderer/types/canvas.ts`
- Modify: `src/renderer/stores/canvas.ts` — re-export from new file
- Modify: every file that imports types from `@/stores/canvas` — update import path

**Step 1: Create the types file**

Move all type/interface declarations from `src/renderer/stores/canvas.ts` lines 3-55 into `src/renderer/types/canvas.ts`. This includes `CanvasTab`, `ViewportMode`, `A11yInfo`, `ParentLayoutInfo`, `ElementContext`, `PreviewError`, `ConsoleLogEntry`.

**Step 2: Update canvas store to re-export**

Replace the type declarations in `src/renderer/stores/canvas.ts` with:
```typescript
import type { CanvasTab, ViewportMode, ElementContext, PreviewError, ConsoleLogEntry } from '@/types/canvas'
export type { CanvasTab, ViewportMode, A11yInfo, ParentLayoutInfo, ElementContext, PreviewError, ConsoleLogEntry } from '@/types/canvas'
```

This keeps all existing imports working during migration.

**Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass — re-exports preserve every import.

**Step 4: Commit**

```
refactor: extract canvas types to shared types file
```

---

### Task 2: Add `previewErrors` and `consoleLogs` to TabState

The only non-deprecated fields in canvas store are `previewErrors` (capped at 20) and `consoleLogs` (capped at 50). These are logically per-tab (each tab has its own iframe). Move them to the tabs store.

**Files:**
- Modify: `src/renderer/stores/tabs.ts` — add fields + helper actions
- Modify: `src/renderer/types/canvas.ts` — import types from there

**Step 1: Add fields to TabState**

In `src/renderer/stores/tabs.ts`, add to the `TabState` interface (after line 48):
```typescript
previewErrors: PreviewError[]
consoleLogs: ConsoleLogEntry[]
```

Add to `createDefaultTabState()` (after line 98):
```typescript
previewErrors: [],
consoleLogs: [],
```

Import the types:
```typescript
import type { PreviewError, ConsoleLogEntry } from '@/types/canvas'
```

**Step 2: Add helper actions to TabsStore interface and implementation**

Add to the `TabsStore` interface:
```typescript
addPreviewError: (tabId: string, err: PreviewError) => void
clearPreviewErrors: (tabId: string) => void
addConsoleLog: (tabId: string, entry: ConsoleLogEntry) => void
clearConsoleLogs: (tabId: string) => void
```

Implement in the create() body (ring-buffer logic matching canvas store):
```typescript
addPreviewError: (tabId, err) => {
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId ? { ...t, previewErrors: [...t.previewErrors.slice(-19), err] } : t
    ),
  }))
},
clearPreviewErrors: (tabId) => {
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, previewErrors: [] } : t)),
  }))
},
addConsoleLog: (tabId, entry) => {
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId ? { ...t, consoleLogs: [...t.consoleLogs.slice(-49), entry] } : t
    ),
  }))
},
clearConsoleLogs: (tabId) => {
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, consoleLogs: [] } : t)),
  }))
},
```

**Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass — new fields are additive.

**Step 4: Commit**

```
refactor: add previewErrors and consoleLogs to per-tab state
```

---

### Task 3: Migrate all canvas store consumers to tabs store

Systematically replace every `useCanvasStore` read/write with the equivalent `useTabsStore` call. This is the largest single task. Work file-by-file.

**Files to modify (production code only — tests updated in Task 4):**

1. `src/renderer/hooks/useMcpStateExposer.ts` — reads `activeTab`, `inspectorActive`, `selectedElements`, `previewErrors`, calls `addPreviewError`, `addConsoleLog`, `clearPreviewErrors`, `clearConsoleLogs`
2. `src/renderer/hooks/useMcpCommands.ts` — calls `setActiveTab('gallery')`, `setActiveTab('diff')`, `setDiffHashes()`
3. `src/renderer/hooks/useKeyboardShortcuts.ts` — reads `inspectorActive`, calls `setInspectorActive`, `setActiveTab`
4. `src/renderer/hooks/useAutoCheckpoint.ts` — calls `setDiffHashes()`, reads `activeTab`
5. `src/renderer/hooks/useInspector.ts` — reads `inspectorActive`, calls `addSelectedElement`, `clearSelectedElements`
6. `src/renderer/hooks/useRenderRouter.ts` — calls `setPreviewUrl`
7. `src/renderer/components/Workspace/Workspace.tsx` — reads `viewportMode`
8. `src/renderer/components/Canvas/CanvasPanel.tsx` — reads `inspectorActive`, `selectedElements.length`
9. `src/renderer/components/Canvas/ConsoleOverlay.tsx` — reads `consoleLogs`, calls `clearConsoleLogs`
10. `src/renderer/components/Canvas/ScreenshotOverlay.tsx` — calls `setScreenshotMode`
11. `src/renderer/components/Canvas/A11yAudit.tsx` — reads `previewUrl`
12. `src/renderer/components/Canvas/PerfMetrics.tsx` — reads `previewUrl`
13. `src/renderer/components/Canvas/DesignFeedback.tsx` — reads `previewUrl`
14. `src/renderer/components/CheckpointTimeline/Timeline.tsx` — reads `diffBeforeHash`, `diffAfterHash`, calls `setDiffHashes`, `setActiveTab`
15. `src/renderer/components/DiffView/DiffView.tsx` — reads `diffBeforeHash`, `diffAfterHash`, `previewUrl`
16. `src/renderer/components/StatusBar/StatusBar.tsx` — reads `inspectorActive`, calls `setInspectorActive`
17. `src/renderer/components/QuickActions/QuickActions.tsx` — reads `inspectorActive`, calls `setInspectorActive`, `setActiveTab`, `setScreenshotMode`, `clearPreviewErrors`, `clearConsoleLogs`

**Migration pattern for each file:**

For reads, replace:
```typescript
// OLD
const inspectorActive = useCanvasStore((s) => s.inspectorActive)
// NEW
const inspectorActive = useTabsStore((s) => s.tabs.find(t => t.id === s.activeTabId)?.inspectorActive ?? false)
```

Or use the existing `selectActiveTab` helper:
```typescript
const tab = useTabsStore(selectActiveTab)
const inspectorActive = tab?.inspectorActive ?? false
```

For writes, replace:
```typescript
// OLD
useCanvasStore.getState().setActiveTab('gallery')
// NEW
const activeTab = useTabsStore.getState().getActiveTab()
if (activeTab) useTabsStore.getState().updateTab(activeTab.id, { activeCanvasTab: 'gallery' })
```

Note the field name difference: canvas store uses `activeTab`, tabs store uses `activeCanvasTab`.

**Step 1: Migrate hooks (files 1-6)**

Work through each hook file. Remove `import { useCanvasStore } from '@/stores/canvas'` and replace with tabs store reads/writes. For `useMcpStateExposer.ts`, use the new `addPreviewError(tabId, err)` and `addConsoleLog(tabId, entry)` actions from Task 2.

**Step 2: Migrate components (files 7-17)**

Work through each component. Same pattern.

**Step 3: Run tests and build**

Run: `npm test && npm run build`
Some tests may fail because they directly reference `useCanvasStore` — that's expected, fixed in Task 4.

**Step 4: Commit**

```
refactor: migrate all canvas store consumers to tabs store
```

---

### Task 4: Update tests and delete canvas store

**Files:**
- Modify: `src/renderer/__tests__/stores.test.ts` — update canvas store tests to tabs store
- Modify: `src/renderer/__tests__/screen-routing.test.ts` — remove canvas store usage
- Modify: `src/renderer/__tests__/mcp-commands.test.ts` — remove canvas store usage
- Modify: `src/renderer/__tests__/features-plan.test.ts` — update canvas store tests to tabs store
- Modify: `src/renderer/__tests__/fixes-plan.test.ts` — update canvas store imports
- Delete: `src/renderer/stores/canvas.ts`

**Step 1: Update each test file**

Replace `useCanvasStore.getState().setActiveTab('gallery')` with the tabs store equivalent. For tests that need a tab to exist, create one first:
```typescript
const tabId = useTabsStore.getState().addTab({ name: 'test', path: '/tmp/test' })
useTabsStore.getState().updateTab(tabId, { activeCanvasTab: 'gallery' })
expect(useTabsStore.getState().tabs[0].activeCanvasTab).toBe('gallery')
```

**Step 2: Delete the canvas store**

Remove `src/renderer/stores/canvas.ts`. The type re-exports in Task 1 mean `@/types/canvas` is now the canonical import path.

**Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass. If any file still imports `@/stores/canvas`, the build will fail — fix the import.

**Step 4: Commit**

```
refactor: delete deprecated canvas store — tabs store is single source of truth
```

---

### Task 5: Delete `useDevServerSync` bridge hook

This hook only existed to sync tabs store → canvas store. With canvas store gone, it's dead code.

**Files:**
- Delete: `src/renderer/hooks/useDevServerSync.ts`
- Modify: `src/renderer/App.tsx` line 19 and 74 — remove import and `useDevServerSync()` call

**Step 1: Remove from App.tsx**

Delete the import line and the `useDevServerSync()` call.

**Step 2: Delete the file**

Remove `src/renderer/hooks/useDevServerSync.ts`.

**Step 3: Run tests and build**

Run: `npm test && npm run build`

**Step 4: Commit**

```
refactor: delete useDevServerSync bridge hook (no longer needed)
```

---

### Task 6: Clean up deprecated project store fields

Remove `isDevServerRunning`, `mcpReady`, `mcpPort` from `useProjectStore`. Migrate the remaining consumers.

**Files:**
- Modify: `src/renderer/stores/project.ts` — remove deprecated fields and setters
- Modify: `src/renderer/hooks/usePty.ts` lines 16-33 — replace `useProjectStore.mcpReady` with tabs store
- Modify: `src/renderer/App.tsx` lines 108, 128 — replace `useProjectStore.setMcpReady()` calls

**Step 1: Update usePty.ts `waitForMcpReady()`**

Replace the function (lines 16-34) to subscribe to tabs store instead:
```typescript
function waitForMcpReady(tabId: string, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    const tab = useTabsStore.getState().tabs.find(t => t.id === tabId)
    if (tab?.mcpReady) { resolve(true); return }
    const unsub = useTabsStore.subscribe((state) => {
      const t = state.tabs.find(t => t.id === tabId)
      if (t?.mcpReady) { unsub(); resolve(true) }
    })
    setTimeout(() => { unsub(); resolve(false) }, timeoutMs)
  })
}
```

Update the `launchClaude` call site to pass `targetTabId`.

**Step 2: Update App.tsx MCP initialization**

In `App.tsx` line 108, replace:
```typescript
useProjectStore.getState().setMcpReady(true, port)
```
With only the tabs store update (the lines that follow already do this).

In line 128, replace:
```typescript
useProjectStore.getState().setMcpReady(false)
```
With nothing — the tabs are being closed anyway.

**Step 3: Remove deprecated fields from project store**

Remove `isDevServerRunning`, `mcpReady`, `mcpPort`, `setDevServerRunning`, `setMcpReady` from the store interface and implementation. Keep `currentProject`, `recentProjects`, `screen` and their setters — those are still actively used and are genuinely global (not per-tab).

**Step 4: Run tests and build**

Run: `npm test && npm run build`

**Step 5: Commit**

```
refactor: remove deprecated fields from project store
```

---

### Task 7: Clean up terminal store

The terminal store has deprecated `ptyId`/`setPtyId` and `isRunning`/`setIsRunning`. The non-deprecated fields (`focusFn`, `focus`, `splits`, `instances`, `activeInstance`) are genuinely global/cross-tab and should stay.

**Files:**
- Modify: `src/renderer/stores/terminal.ts` — remove deprecated fields
- Modify: `src/renderer/hooks/usePty.ts` — remove `setPtyId`, `setIsRunning` calls
- Modify: `src/renderer/components/Canvas/ConsoleOverlay.tsx` — replace `store.ptyId` read with tabs store

**Step 1: Update usePty.ts**

Remove `const { setPtyId, setIsRunning } = useTerminalStore()` (line 41).
Remove `setPtyId(id)` call (line 63).
Remove `setIsRunning(true)` (line 77).
Remove `setIsRunning(false)` and `setPtyId(null)` from onExit handler (lines 156-157).

The PTY ID is already stored in tabs store (line 70-74). The `isRunning` state can be derived from `tab.ptyId !== null`.

**Step 2: Update ConsoleOverlay.tsx**

Replace `useTerminalStore.getState().ptyId` with reading from tabs store:
```typescript
const tab = useTabsStore.getState().getActiveTab()
if (!tab?.ptyId) return
window.api.pty.write(tab.ptyId, prompt)
```

Also check `Gallery.tsx` `typeIntoTerminal()` helper (line 36) — same pattern.

**Step 3: Remove deprecated fields from terminal store**

Remove `ptyId`, `isRunning`, `setPtyId`, `setIsRunning` from the interface and implementation. Keep `focusFn`, `focus`, `splits`, `instances`, `activeInstance` and their methods.

**Step 4: Run tests and build**

Run: `npm test && npm run build`

**Step 5: Commit**

```
refactor: remove deprecated ptyId/isRunning from terminal store
```

---

## Phase 2: Component & File Splitting (Maintainability)

---

### Task 8: Split `Gallery.tsx` into focused components

The Gallery component is 1,063 lines handling grid view, compare view, session mode, and card rendering. Split into focused pieces.

**Files:**
- Create: `src/renderer/components/Gallery/GridView.tsx` — grid layout + drag-drop
- Create: `src/renderer/components/Gallery/CompareView.tsx` — side-by-side comparison
- Create: `src/renderer/components/Gallery/SessionPanel.tsx` — design session UI
- Create: `src/renderer/components/Gallery/GalleryCard.tsx` — individual card (extract from inline)
- Create: `src/renderer/components/Gallery/constants.ts` — magic numbers (`BLEED`, `DEFAULT_CARD_HEIGHT`, `DRAG_THRESHOLD`, viewport presets)
- Modify: `src/renderer/components/Gallery/Gallery.tsx` — reduce to orchestrator (~100 lines)

**Step 1: Extract constants**

Move `VIEWPORT_PRESETS`, `BLEED`, `DEFAULT_CARD_HEIGHT`, and the `Tip` component into `constants.ts`.

**Step 2: Extract GalleryCard**

The card rendering logic (currently inline in Gallery.tsx around line 628+) becomes its own component. Wrap it in `React.memo()` with a custom comparator:
```typescript
export const GalleryCard = memo(function GalleryCard(props: GalleryCardProps) {
  // ... existing card JSX
}, (prev, next) => {
  return prev.variant.id === next.variant.id
    && prev.variant.updatedAt === next.variant.updatedAt
    && prev.isSelected === next.isSelected
    && prev.isInteracting === next.isInteracting
    && prev.cardWidth === next.cardWidth
})
```

**Step 3: Extract GridView, CompareView, SessionPanel**

Each gets the relevant state reads and JSX. Gallery.tsx becomes:
```typescript
export function Gallery() {
  const { variants, viewMode } = useGalleryStore()
  if (variants.length === 0) return <EmptyState />
  if (viewMode === 'compare') return <CompareView />
  if (viewMode === 'session') return <SessionPanel />
  return <GridView />
}
```

**Step 4: Run tests and build**

Run: `npm test && npm run build`

**Step 5: Commit**

```
refactor: split Gallery.tsx into focused sub-components
```

---

### Task 9: Split `git.ts` into focused modules

The git service is 733 lines containing 5 separate concerns. Split them.

**Files:**
- Create: `src/main/services/git-diagnostics.ts` — FD counting, EBADF detection, categorizeFds
- Create: `src/main/services/git-queue.ts` — per-repo serial queue, spawn gate, withEbadfRetry
- Modify: `src/main/services/git.ts` — keep only IPC handlers, import from new modules

**Step 1: Extract diagnostics**

Move `countOpenFds()`, `categorizeFds()`, `isEbadfError()`, `logFdDiagnostics()` into `git-diagnostics.ts`. Export them.

**Step 2: Extract queue system**

Move `enqueue()`, `resolveGitRoot()`, `gitQueues`, `gitInstances`, `getGit()`, `cleanupGitInstance()`, `withEbadfRetry()` into `git-queue.ts`. Export them.

**Step 3: Update git.ts imports**

Replace the moved code with imports from the new files. The IPC handlers stay in `git.ts`.

**Step 4: Run tests and build**

Run: `npm test && npm run build`

**Step 5: Commit**

```
refactor: split git.ts into diagnostics, queue, and handlers
```

---

### Task 10: Split `mcp/tools.ts` into domain modules

765 lines with 35+ tools. Split by domain and extract shared helpers.

**Files:**
- Create: `src/main/mcp/helpers.ts` — `errorResponse()`, `requireWindow()`, `executeInRenderer()`
- Create: `src/main/mcp/canvas-tools.ts` — all `canvas_*` tool registrations
- Create: `src/main/mcp/supabase-tools.ts` — all `supabase_*` tools + `requireSupabaseAuth`
- Create: `src/main/mcp/devserver-tools.ts` — `configure_dev_server`, `analyze_dev_server`
- Modify: `src/main/mcp/tools.ts` — becomes barrel that calls register functions from each module

**Step 1: Extract helpers**

```typescript
// src/main/mcp/helpers.ts
export function errorResponse(msg: string): McpTextResult {
  return { content: [{ type: 'text', text: msg }] }
}

export function requireWindow(getWindow: () => BrowserWindow | null): BrowserWindow {
  const win = getWindow()
  if (!win) throw new Error('No window available')
  return win
}
```

**Step 2: Extract each domain file**

Move the tool registrations into their domain files. Each exports a `registerXxxTools(server, getWindow, projectPath)` function.

**Step 3: Update tools.ts as barrel**

```typescript
export function registerMcpTools(server: McpServer, getWindow: () => BrowserWindow | null, projectPath: string): void {
  registerCanvasTools(server, getWindow, projectPath)
  registerSupabaseTools(server, getWindow, projectPath)
  registerDevServerTools(server, getWindow, projectPath)
}
```

**Step 4: Run tests and build**

Run: `npm test && npm run build`

**Step 5: Commit**

```
refactor: split MCP tools into domain-specific modules
```

---

## Phase 3: Reliability & Error Handling

---

### Task 11: Make `git:squashAndPush` safe with backup ref

Currently, if push fails after `git reset --soft`, the repo is in a modified state. Add a backup ref for rollback.

**Files:**
- Modify: `src/main/services/git.ts` — `git:squashAndPush` handler (around line 520-596)

**Step 1: Add backup ref before squash**

Before the `reset --soft` (around line 584), create a backup:
```typescript
// Create backup before destructive squash operation
await withEbadfRetry(() => g.raw(['tag', '-f', '_claude_canvas_backup']), 3, 'git:push:backup')
```

**Step 2: Add rollback on push failure**

In the catch block (around line 588), restore from backup:
```typescript
catch (err: any) {
  // Attempt rollback to pre-squash state
  try {
    await g.raw(['reset', '--soft', '_claude_canvas_backup'])
  } catch (rollbackErr) {
    console.error('[git] rollback failed:', rollbackErr)
  }
  // ... existing error handling
}
```

**Step 3: Clean up backup on success**

After successful push (after line 586):
```typescript
// Clean up backup ref on success
try { await g.raw(['tag', '-d', '_claude_canvas_backup']) } catch { /* tag may not exist */ }
```

**Step 4: Run tests and build**

Run: `npm test && npm run build`

**Step 5: Commit**

```
fix: add backup ref to squashAndPush for safe rollback on failure
```

---

### Task 12: Fix silent stash pop failure

The `git:pull` handler (line 506-511) catches ALL stash pop errors and returns `{ success: true, conflicts: true }`. Real errors (e.g., stash corruption) should propagate.

**Files:**
- Modify: `src/main/services/git.ts` — `git:pull` handler (around line 505-511)

**Step 1: Distinguish conflicts from real errors**

Replace the catch block:
```typescript
try {
  await g.stash(['pop'])
  return { success: true, conflicts: false }
} catch (popErr: any) {
  const msg = popErr?.message || ''
  if (msg.includes('CONFLICT') || msg.includes('could not apply')) {
    return { success: true, conflicts: true }
  }
  return { success: false, error: sanitizeGitError(msg || 'Stash pop failed after pull') }
}
```

**Step 2: Run tests and build**

Run: `npm test && npm run build`

**Step 3: Commit**

```
fix: distinguish stash pop conflicts from real errors in git:pull
```

---

### Task 13: Add timeout to `executeJavaScript` calls in MCP tools

MCP tools call `win.webContents.executeJavaScript()` without timeout. If the renderer freezes, the MCP session hangs indefinitely.

**Files:**
- Modify: `src/main/mcp/helpers.ts` (or `tools.ts` if Task 10 not yet done) — add timeout wrapper

**Step 1: Create timeout wrapper**

```typescript
export async function executeWithTimeout<T>(
  win: BrowserWindow,
  code: string,
  timeoutMs = 5000
): Promise<T> {
  return Promise.race([
    win.webContents.executeJavaScript(code) as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Renderer did not respond within timeout')), timeoutMs)
    ),
  ])
}
```

**Step 2: Replace direct `executeJavaScript` calls**

Search `tools.ts` for all `win.webContents.executeJavaScript(` calls and replace with `executeWithTimeout(win, ...)`. Wrap each in try-catch that returns an error response.

**Step 3: Run tests and build**

Run: `npm test && npm run build`

**Step 4: Commit**

```
fix: add timeout to MCP tool executeJavaScript calls
```

---

### Task 14: Add file watcher event coalescing

File changes currently fire individual IPC messages. Rapid saves (e.g., Prettier running after save) flood the renderer.

**Files:**
- Modify: `src/main/watcher.ts` — batch events with 200ms window

**Step 1: Add batching**

Replace the individual event handlers (lines 48-67) with a coalescing pattern:

```typescript
let pending: { type: string; path: string; projectPath: string }[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function enqueueEvent(type: string, filePath: string, projectPath: string) {
  pending.push({ type, path: filePath, projectPath })
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        // Deduplicate: keep last event per path
        const deduped = new Map<string, typeof pending[0]>()
        for (const evt of pending) deduped.set(evt.path, evt)
        for (const evt of deduped.values()) {
          win.webContents.send(`fs:${evt.type}`, { projectPath: evt.projectPath, path: evt.path })
        }
      }
      pending = []
      flushTimer = null
    }, 200)
  }
}

w.on('change', (p) => enqueueEvent('change', p, projectPath))
w.on('add', (p) => enqueueEvent('add', p, projectPath))
w.on('unlink', (p) => enqueueEvent('unlink', p, projectPath))
```

**Step 2: Run tests and build**

Run: `npm test && npm run build`

**Step 3: Commit**

```
perf: coalesce file watcher events with 200ms batching window
```

---

## Phase 4: Performance Fixes

---

### Task 15: Fix Workspace `useTabList` memoization

The spread-all-IDs dependency array defeats memoization on every tab reorder.

**Files:**
- Modify: `src/renderer/components/Workspace/Workspace.tsx` lines 23-30

**Step 1: Replace with stable comparison**

```typescript
function useTabList() {
  return useTabsStore(
    useCallback(
      (s: { tabs: TabState[] }) =>
        s.tabs.map((t) => ({ id: t.id, projectPath: t.project.path, projectName: t.project.name })),
      []
    ),
    // Shallow compare the mapped array
    (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i].id)
  )
}
```

This uses Zustand's selector equality function to only trigger re-renders when tab IDs actually change.

**Step 2: Run tests and build**

Run: `npm test && npm run build`

**Step 3: Commit**

```
perf: fix useTabList memoization with stable equality check
```

---

### Task 16: Add `scheduleRelayout` project-path guard

The 800ms relayout timer in Gallery.tsx can fire after a project switch, applying stale layout to a new gallery.

**Files:**
- Modify: `src/renderer/components/Gallery/Gallery.tsx` (or `GridView.tsx` if Task 8 done) — the `scheduleRelayout` callback

**Step 1: Capture project path and guard**

```typescript
const scheduleRelayout = useCallback(() => {
  if (didInitialRelayout.current) return
  const capturedProject = useGalleryStore.getState().projectPath
  if (initialRelayoutTimer.current) clearTimeout(initialRelayoutTimer.current)
  initialRelayoutTimer.current = setTimeout(() => {
    // Bail if user switched projects during the delay
    if (useGalleryStore.getState().projectPath !== capturedProject) return
    didInitialRelayout.current = true
    const store = useGalleryStore.getState()
    const updated = fullRelayout(store.cardPositions)
    store.setCardPositions(updated)
  }, 800)
}, [])
```

**Step 2: Reset `didInitialRelayout` on project change**

Add a `useEffect` that resets the ref when gallery project changes:
```typescript
const galleryProject = useGalleryStore((s) => s.projectPath)
useEffect(() => {
  didInitialRelayout.current = false
}, [galleryProject])
```

**Step 3: Run tests and build**

Run: `npm test && npm run build`

**Step 4: Commit**

```
fix: guard gallery relayout timer against stale project switch
```

---

### Task 17: Handle WebGL context loss recovery

When WebGL context is lost, the addon is disposed but never recreated, leaving a blank terminal.

**Files:**
- Modify: `src/renderer/components/Terminal/TerminalView.tsx` — WebGL addon setup (around line 100-110)

**Step 1: Add recovery logic**

Replace the context loss handler:
```typescript
try {
  const webgl = new WebglAddon()
  webgl.onContextLoss(() => {
    console.warn('[terminal] WebGL context lost — disposing, will recreate on next fit')
    webgl.dispose()
    webglRef.current = null
  })
  terminal.loadAddon(webgl)
  webglRef.current = webgl
} catch {
  console.warn('WebGL addon failed to load, using canvas renderer')
}
```

Then in the ResizeObserver / fit callback, add a recovery check:
```typescript
// Attempt to recover WebGL if previously lost
if (!webglRef.current && containerRef.current) {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      webglRef.current = null
    })
    terminal.loadAddon(webgl)
    webglRef.current = webgl
  } catch { /* stay on canvas renderer */ }
}
```

**Step 2: Run tests and build**

Run: `npm test && npm run build`

**Step 3: Commit**

```
fix: recover WebGL addon after context loss in terminal
```

---

## Phase 5: Cleanup & Polish

---

### Task 18: Clean up unused CSS variables

The `--v9-*` variables were suspected unused but are actually used by `ServiceIcons.tsx`. Verify and document.

**Files:**
- Modify: `src/renderer/styles/globals.css` — add comment grouping

**Step 1: Add documentation comment**

Group the v9 variables with a comment explaining their purpose:
```css
/* Service integration palette (used by ServiceIcons — GitHub/Vercel/Supabase panels) */
--v9-surface: #111113;
/* ... rest of v9 vars ... */
```

This is a no-op change — just documentation so future developers don't think they're dead code.

**Step 2: Commit**

```
docs: document v9 CSS variable usage in globals.css
```

---

### Task 19: Persist window bounds across restarts

Window position and size are lost on every launch.

**Files:**
- Modify: `src/main/index.ts` — save bounds on move/resize, restore on create

**Step 1: Save bounds**

After `createWindow()`, add listeners:
```typescript
mainWindow.on('resize', () => {
  if (!mainWindow.isMaximized()) {
    settingsStore.set('windowBounds', mainWindow.getBounds())
  }
})
mainWindow.on('move', () => {
  if (!mainWindow.isMaximized()) {
    settingsStore.set('windowBounds', mainWindow.getBounds())
  }
})
```

**Step 2: Restore bounds**

In `createWindow()`, read saved bounds:
```typescript
const savedBounds = settingsStore.get('windowBounds') as Electron.Rectangle | undefined
const mainWindow = new BrowserWindow({
  width: savedBounds?.width || 960,
  height: savedBounds?.height || 700,
  x: savedBounds?.x,
  y: savedBounds?.y,
  // ... rest of options
})
```

**Step 3: Run tests and build**

Run: `npm test && npm run build`

**Step 4: Commit**

```
feat: persist window position and size across restarts
```

---

### Task 20: Add missing test setup mocks

The test setup file is missing mocks for `worktree`, `screenshot`, and `inspector` preload methods.

**Files:**
- Modify: `src/renderer/__tests__/setup.ts` — add missing namespace mocks

**Step 1: Add missing mocks**

Add to the `window.api` mock object:
```typescript
worktree: {
  create: vi.fn().mockResolvedValue({ path: '/tmp/worktree', branch: 'test' }),
},
screenshot: {
  capture: vi.fn().mockResolvedValue('/tmp/screenshot.png'),
  captureCheckpoint: vi.fn().mockResolvedValue('/tmp/checkpoint.png'),
  loadCheckpoint: vi.fn().mockResolvedValue(null),
},
inspector: {
  inject: vi.fn().mockResolvedValue(undefined),
  findFile: vi.fn().mockResolvedValue(null),
},
```

**Step 2: Run tests**

Run: `npm test`
Expected: All pass — new mocks are additive.

**Step 3: Commit**

```
test: add missing preload mocks for worktree, screenshot, inspector
```

---

## Verification Checklist

After all tasks are complete:

1. `npm test` — all tests pass
2. `npm run build` — production build succeeds
3. `npm run dev` — app launches, terminal works, Claude starts
4. Open 2 tabs → verify each tab has independent console logs and preview errors
5. Gallery renders correctly with drag-drop
6. Checkpoint timeline and diff view work
7. Inspector toggle works from status bar and keyboard shortcut
8. Close and reopen app → verify window position is restored
9. `git status` — verify all changes are committed cleanly

---

## Task Dependency Graph

```
Phase 1 (sequential):
  Task 1 → Task 2 → Task 3 → Task 4 → Task 5
  Task 6 (parallel with 3-5, after Task 2)
  Task 7 (parallel with 3-5, after Task 2)

Phase 2 (parallel, after Phase 1):
  Task 8 ──┐
  Task 9 ──┼── all independent
  Task 10 ─┘

Phase 3 (parallel, after Phase 1):
  Task 11 ─┐
  Task 12 ─┤
  Task 13 ─┼── all independent
  Task 14 ─┘

Phase 4 (after Phase 1, Task 8):
  Task 15 ─┐
  Task 16 ─┼── all independent
  Task 17 ─┘

Phase 5 (after all above):
  Task 18 ─┐
  Task 19 ─┼── all independent
  Task 20 ─┘
```
