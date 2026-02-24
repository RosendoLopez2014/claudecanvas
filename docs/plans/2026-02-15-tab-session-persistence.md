# Tab Session Persistence & Project Addition

> **Date**: 2026-02-15
> **Status**: Resolved
> **Issue**: Claude disappears from Tab 1 when adding a second project; app freezes on tab close

---

## 1. Current Architecture

### Tab Lifecycle

```
ProjectPicker.openProject()
  → tabs.addTab(project)           // Creates TabState in Zustand, sets activeTabId
  → project.setCurrentProject()    // Updates project store (delayed by one render)
  → project.setScreen('workspace') // Transitions from project-picker to workspace

Workspace renders ALL tabs simultaneously:
  tabList.map(tab => <TerminalView tabId={tab.id} isTabActive={tab.id === activeTabId} />)

Each TerminalView:
  → SplitPane mounts → usePty().connect() → spawns PTY → launches Claude
  → Hidden tabs use CSS visibility:hidden (stay mounted, PTY alive)
```

### Adding a Second Project (the bug path)

```
User in workspace with Tab 1 (Claude running)
  → Click "+" → NewTabMenu → "Different project"
  → handleDifferentProject() calls setScreen('project-picker')
  → App.tsx: {screen === 'workspace' && <Workspace />}  ← UNMOUNTS Workspace entirely
  → All SplitPane components unmount
  → usePty cleanup effect KILLS Tab 1's PTY
  → User picks project 2 → openProject() creates Tab 2
  → setScreen('workspace') → Workspace REMOUNTS
  → Tab 1 SplitPane remounts → gets STALE terminal from pool → terminal.open() fails
  → Tab 2 SplitPane mounts fresh → works fine
  → Result: Tab 1 blank, Tab 2 works
```

### Adding via Worktree (no bug)

The "New branch (worktree)" and "Existing branch" flows in NewTabMenu do NOT navigate away from the workspace. They call `addTab()` directly while staying on `screen='workspace'`. Workspace stays mounted, Tab 1's SplitPane stays alive, and the new tab's SplitPane mounts alongside it. **This path works correctly.**

---

## 2. Integration Systems (Working Correctly)

These systems were fixed in the earlier tab-switching-architecture work and should NOT be disrupted by any changes here.

### GitHub (git sync)

- **Source of truth**: `tab.githubRepoName` in TabState (tabs store)
- **Local refresh** (`useGitSync`): On tab switch, reads branch + remote from local git. Uses `tab.project.path` (atomic with `activeTabId`). Never overwrites cached repo name with null.
- **Network fetch** (`useGitSync`): On focus/interval, runs `git fetch` for ahead/behind counts. Cooldown prevents refetch within 30s.
- **ServiceIcons GitHub effect**: Fetches `getProjectInfo(tabPath)` on `activeTabId` change. Keeps cached `githubRepoName` if transient fetch returns null.
- **Key invariant**: Never downgrade `githubRepoName` from a known value to null.

### Vercel

- **Source of truth**: `tab.vercelLinkedProject` + `tab.vercelBootstrapped` in TabState
- **Bootstrap flow**: On first tab activation with Vercel OAuth connected, fetches linked project. Marks `vercelBootstrapped: true` only on successful response application.
- **Inflight dedup**: `vercelInflightRef` (Set keyed by `${tabId}:${path}`) prevents duplicate concurrent requests.
- **Cache load**: On tab switch, immediately loads `tab.vercelLinkedProject` into local state.
- **Key invariant**: Bootstrap "done" flag only set after successful fetch, never on discard.

### Supabase

- **Source of truth**: `tab.supabaseLinkedProject` + `tab.supabaseBootstrapped` in TabState
- **Same pattern as Vercel**: Inflight dedup via `supabaseInflightRef`, done-on-success-only, cache load on tab switch.

### Generation Counter (fetch staleness guard)

- `fetchGenRef.current` incremented in `useLayoutEffect` whenever `activeTabId` changes.
- All async fetches capture `gen` at start, discard response if `gen` has changed.
- Prevents stale data from slow fetches being written to the wrong tab.

### Screen Guard

- `ServiceIcons` only renders when `screen === 'workspace'` (TitleBar.tsx).
- Prevents integration icons from showing stale data on the project picker screen.

---

## 3. The Bug: Screen Transition Kills PTYs

### Root Cause

In `App.tsx` line 118:
```tsx
{screen === 'workspace' && <Workspace />}
```

When `screen` changes from `'workspace'` to `'project-picker'`, React unmounts `<Workspace>`. This cascades:

1. All `TerminalView` components unmount
2. All `TerminalContent` components unmount
3. All `SplitPane` components unmount
4. `usePty`'s cleanup effect runs → **kills the PTY** (`window.api.pty.kill(ptyIdRef.current)`)
5. The terminal object remains in the `terminalPool` Map (stale)

When the user picks a project and returns to workspace:

1. Workspace remounts → renders all tabs
2. Tab 1's SplitPane remounts with `initializedRef = false` (new instance)
3. `getOrCreateTerminal(poolKey)` returns the **stale** terminal from pool
4. `terminal.open(container)` either throws (xterm.js doesn't allow re-open) or silently fails
5. `connect()` spawns a new PTY, but data goes to a non-rendering terminal
6. Tab 1 appears blank

Tab 2 works because it's new — fresh terminal, fresh PTY, clean initialization.

### Why Within-Workspace Tab Switching Works

Tabs within the workspace use `visibility: hidden/visible` and stay mounted. SplitPane never unmounts, so PTY stays alive. The terminal pool caches Terminal instances so WebGL contexts aren't destroyed.

---

## 4. Fix: Keep Workspace Mounted (Implemented)

### Approach

Follow the same pattern used for tabs within Workspace: once Workspace has been rendered, keep it in the DOM with `visibility: hidden` when navigating to project picker, rather than unmounting it.

### Changes Made

**`src/renderer/App.tsx`** — three changes:

**1. Workspace persistence (visibility-based, normal flex flow):**
```tsx
const [workspaceMounted, setWorkspaceMounted] = useState(false)
useEffect(() => {
  if (screen === 'workspace') setWorkspaceMounted(true)
}, [screen])

// Workspace stays in normal flex flow (h-full, not absolute)
// so TabBar and StatusBar get their flex space.
{(screen === 'workspace' || workspaceMounted) && (
  <div className="h-full" style={{
    visibility: screen === 'workspace' ? 'visible' : 'hidden',
  }}>
    <Workspace />
  </div>
)}

// ProjectPicker overlays as absolute when workspace is already mounted
{screen === 'project-picker' && (
  <div className={workspaceMounted ? 'absolute inset-0 z-10 bg-[var(--bg-primary)]' : 'h-full'}>
    <ProjectPicker />
  </div>
)}
```

- `visibility: hidden` (not `display: none`) — keeps elements in layout flow so xterm.js/WebGL can still measure dimensions. `display: none` gives 0x0 which breaks terminal renderers.
- Workspace renders in **normal flex flow** (`h-full`) — not `absolute inset-0` which takes it out of flow and collapses TabBar/StatusBar.
- ProjectPicker overlays as `absolute inset-0 z-10` when returning from workspace, covering the hidden Workspace.
- `workspaceMounted` gate — Workspace doesn't mount on app startup, only on first workspace entry.

**1b. Navigate to project picker when all tabs closed:**
```tsx
const tabCount = useTabsStore((s) => s.tabs.length)
useEffect(() => {
  if (workspaceMounted && tabCount === 0 && screen === 'workspace') {
    setScreen('project-picker')
  }
}, [tabCount, workspaceMounted, screen, setScreen])
```

**2. MCP teardown changed from screen-based to tab-count-based:**
```tsx
// Before: tore down MCP when screen !== 'workspace' (killed during picker visit)
// After: only tears down when all tabs are closed
if (tabCount === 0 && mcpStartedRef.current) {
  mcpStartedRef.current = false
  window.api.mcp.projectClosed()
  useProjectStore.getState().setMcpReady(false)
}
```

This prevents Claude sessions from losing their MCP connection when the user visits the project picker to add another project.

**`src/renderer/services/terminalPool.ts`** — hardened against stale terminals:

**3. Stale terminal detection in `getOrCreateTerminal`:**
```tsx
// If pooled terminal's container is no longer in the DOM, dispose and recreate
const isStale = existing.container && !existing.container.isConnected
if (!isStale) return existing.terminal
existing.terminal.dispose()
pool.delete(tabId)
```

**4. `destroyTerminalsForTab(tabId)` — proper cleanup on tab close:**

Previously, `destroyTerminal(tabId)` was called with a bare tab ID, but pool keys are `${tabId}:${instanceId}`. The function never matched anything — terminal resources leaked on every tab close. New `destroyTerminalsForTab` iterates the pool and destroys all entries matching the tab prefix.

**`src/renderer/components/TabBar/TabBar.tsx`** — resilient close handler:

**5. Try/catch/finally on tab close:**

Each IPC cleanup call is wrapped in its own try/catch so failures don't block subsequent cleanup. The `finally` block always clears the fullscreen close overlay and calls `closeTab()`, preventing the overlay from getting stuck.

**6. `destroyTerminalsForTab` import:**

Changed from `destroyTerminal(tabId)` to `destroyTerminalsForTab(tabId)` to match the prefix-based pool keys.

### TabBar and StatusBar

These lightweight UI components continue to use conditional rendering (`screen === 'workspace'`). They have no resources that need preserving — they're pure presentation. Unmounting/remounting them is fine.

### What Stays Unchanged

- All integration code (GitHub, Vercel, Supabase) — already correct
- PTY lifecycle in `usePty.ts` — cleanup effect still kills PTY on true unmount (tab close)
- Tab store (`tabs.ts`) — no changes needed
- Git sync (`useGitSync.ts`) — no changes needed

---

## 5. Edge Cases

### MCP Server on Re-entry

The MCP server init in App.tsx uses `mcpStartedRef` to run once. Since Workspace stays mounted, the MCP server stays alive. No issue.

### Window Resize on Canvas Toggle

Workspace listens for window resize events. When hidden with `visibility: hidden`, the elements retain their layout dimensions (unlike `display: none` which gives 0x0). ResizeObserver in SplitPane is gated on `visible`, so it won't trigger unnecessary fits while the workspace is hidden.

### Multiple Round-Trips

User could go: workspace → picker → workspace → picker → workspace. With the "mount once" approach, each return to workspace is instant. New tabs added via picker get fresh SplitPanes that initialize normally alongside the already-running ones.

### Tab Close While on Project Picker

If we add the ability to close tabs from the project picker, the `cleanupTabResources` function in `tabs.ts` handles PTY cleanup correctly — it reads `tab.ptyId` from the tab store and kills it directly, independent of React lifecycle.

---

## 6. Slow Tab Close Fix: Orphaned Watcher Strategy

### Problem

When closing a tab, `fs:unwatch` IPC calls `w.close()` on a chokidar FSWatcher. Chokidar's `close()` does heavy synchronous work (closing file descriptors, unwatching paths) that blocks the main-process event loop for 7-20 seconds. Even deferring with `setTimeout(fn, 0)` only delays the blocking by one tick — the synchronous work still freezes the entire app when it runs (no IPC, no window events, no rendering).

### Fix

**`src/main/watcher.ts`** — don't call `w.close()` during tab operations at all:

```typescript
// On fs:unwatch:
const w = watchers.get(projectPath)!
watchers.delete(projectPath)
w.removeAllListeners()    // Stop sending stale events
orphanedWatchers.push(w)  // Track for app-exit cleanup
// Do NOT call w.close() — it blocks the event loop for 7-20s

// On app exit (closeWatcher):
for (const w of orphanedWatchers) w.close()  // Safe to block during shutdown
```

**Why not `setTimeout`?** Even with `setTimeout(fn, 0)`, the deferred `w.close()` runs on the next event loop tick and blocks the main process for the same 7-20 seconds. During that time, all IPC calls queue up (including MCP teardown), and the app appears completely frozen.

**Trade-off**: Orphaned watchers consume file descriptors until app exit. For typical usage (1-3 tabs per session), this is negligible. The watchers are stripped of all event listeners so they don't send stale events to the renderer.
