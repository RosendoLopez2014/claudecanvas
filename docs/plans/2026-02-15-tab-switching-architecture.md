# Tab Switching Architecture & Challenges

## Overview

Claude Canvas supports multiple project tabs. Each tab represents an independent workspace with its own PTY shell, git state, dev server, and integration connections (GitHub, Vercel, Supabase). Switching tabs must be instant — the terminal is the primary interface and any lag is immediately felt.

---

## Architecture

### State Layer

```
┌─────────────────────────────────────────────────────────┐
│                     Zustand Stores                       │
├─────────────────────┬───────────────────────────────────┤
│  tabs store         │  Per-tab state (array of TabState)│
│  ├─ activeTabId     │  Each tab owns:                   │
│  ├─ tabs[]          │  • project (path, name, etc.)     │
│  │   ├─ ptyId       │  • ptyId (terminal process)       │
│  │   ├─ gitAhead    │  • git sync state                 │
│  │   ├─ gitBehind   │  • dev server state               │
│  │   ├─ worktreeBranch│ • canvas/gallery state          │
│  │   ├─ githubRepoName│ • integration cache (NEW)       │
│  │   ├─ vercelLinkedProject│                             │
│  │   ├─ supabaseLinkedProject│                           │
│  │   ├─ lastIntegrationFetch│                            │
│  │   └─ ...         │  • MCP bridge state               │
├─────────────────────┼───────────────────────────────────┤
│  project store      │  Derived from active tab:         │
│  └─ currentProject  │  • path, name, devCommand         │
├─────────────────────┼───────────────────────────────────┤
│  workspace store    │  Layout:                          │
│  └─ mode            │  • terminal-only / terminal-canvas│
├─────────────────────┼───────────────────────────────────┤
│  canvas store       │  Canvas panel state               │
│  └─ previewUrl      │  • viewport mode, inspector, etc. │
└─────────────────────┴───────────────────────────────────┘
```

### Component Tree

```
App.tsx
├── TitleBar
├── TabBar                    ← tab click → setActiveTab(id)
├── Workspace
│   ├── FileExplorer (optional sidebar)
│   ├── Terminal pane
│   │   └── TerminalView × N  ← ALL tabs mounted, visibility toggled
│   └── Canvas pane
│       └── CanvasPanel
└── StatusBar                 ← reads from active tab
ServiceIcons (in TitleBar)    ← GitHub/Vercel/Supabase dropdowns
```

### Key Design Decision: All Terminals Stay Mounted

Every tab's `TerminalView` is always in the DOM. Switching tabs toggles `visibility: hidden` — never `display: none` (which destroys WebGL GPU contexts) and never unmount/remount (which kills the PTY). This means:

- Terminal content is preserved (scroll history, cursor position)
- PTY process stays alive (Claude Code session persists)
- WebGL renderer stays initialized (no expensive GPU context recreation)
- xterm.js addons (WebGL, fit, search) stay attached

---

## Integration Detection & Sync

### How Integrations Are Detected on Project Load

When a project tab is created or the app restarts, each integration must discover whether the project is linked to GitHub, Vercel, or Supabase. Detection happens at two levels: a fast local check (GitHub) and background network checks (Vercel, Supabase).

```
Tab created / App restarts
      │
      ├──► useGitSync: local refresh [~60-90ms, no network]
      │    git:getProjectInfo → { branch, remoteUrl }
      │    ├── Updates worktreeBranch, gitRemoteConfigured
      │    └── Parses remoteUrl → githubRepoName (persisted to TabState)
      │        e.g., "https://github.com/owner/repo.git" → "owner/repo"
      │
      ├──► ServiceIcons mount → OAuth status check [~50ms]
      │    Fetches github/vercel/supabase connected status
      │    Sets status.github, status.vercel, status.supabase
      │    (App-global — same tokens for all tabs)
      │
      ├──► ServiceIcons: cache load [immediate, 0ms]
      │    useEffect([activeTabId]) loads from TabState:
      │    ├── tab.githubRepoName → setRepoName()
      │    ├── tab.vercelLinkedProject → setLinkedProject()
      │    └── tab.supabaseLinkedProject → setLinkedSupabaseProject()
      │
      ├──► Vercel bootstrap [~400ms, once per tab]
      │    Guard: bootstrappedVercelRef.has(tabId) → skip
      │    Guard: tab.vercelLinkedProject cached → skip (load from cache)
      │    oauth:vercel:linkedProject({ projectPath, gitRepo })
      │    Persists result → tab.vercelLinkedProject + lastIntegrationFetch
      │
      └──► Supabase bootstrap [~280ms, once per tab]
           Guard: bootstrappedSupabaseRef.has(tabId) → skip
           Guard: tab.supabaseLinkedProject cached → skip (load from cache)
           oauth:supabase:listProjects → match by folder name
           Persists result → tab.supabaseLinkedProject + lastIntegrationFetch
```

### GitHub Detection Flow

GitHub repo detection is **local and instant** — no network required, no OAuth dependency.

```
useGitSync (runs on every tab switch)
      │
      ▼
git:getProjectInfo(projectPath)
      │
      ├── Returns: { branch: "main", remoteUrl: "https://github.com/owner/repo.git" }
      │
      ▼
parseRepoName(remoteUrl)
      │
      ├── Regex: /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/
      │   Handles HTTPS: https://github.com/owner/repo.git
      │   Handles SSH:   git@github.com:owner/repo.git
      │
      ├── Result: "owner/repo" (or null if no remote / not GitHub)
      │
      ▼
updateTab(tabId, { githubRepoName: "owner/repo" })
      │
      └── ServiceIcons reads from TabState → shows in TitleBar immediately
```

**Important:** `githubRepoName` is set in `useGitSync` (fast, local) AND in ServiceIcons' repo fetch effect (when `status.github` becomes true). Both paths persist to TabState. The `useGitSync` path runs first and ensures the repo name is available even before OAuth status loads.

### Vercel Detection Flow

Vercel detection requires a network call — runs once per tab, then cached.

```
ServiceIcons bootstrap effect
      │
      ├── Guard: status.vercel must be true (OAuth connected)
      ├── Guard: bootstrappedVercelRef.has(tabId) → skip (already done)
      ├── Guard: tab.vercelLinkedProject non-null → load from cache, skip fetch
      │
      ▼
oauth:vercel:linkedProject({ projectPath, gitRepo })
      │
      ├── Server-side: Checks Vercel API for project linked to this git repo
      │   or matching the project path name
      │
      ├── Returns: { linked: true, project: {...}, latestDeployment: {...} }
      │         or: { linked: false }
      │
      ▼
updateTab(tabId, {
  vercelLinkedProject: result,
  lastIntegrationFetch: Date.now()
})
      │
      └── UI shows linked project badge / deployment status in dropdown
```

**On dropdown open:** Always refreshes from network (user + linked project data). This catches changes made outside Claude Canvas (e.g., deploying from Vercel dashboard).

### Supabase Detection Flow

Supabase detection matches by project folder name — also requires network.

```
ServiceIcons bootstrap effect
      │
      ├── Guard: status.supabase must be true (OAuth connected)
      ├── Guard: bootstrappedSupabaseRef.has(tabId) → skip (already done)
      ├── Guard: tab.supabaseLinkedProject non-null → load from cache, skip fetch
      │
      ▼
oauth:supabase:listProjects()
      │
      ├── Returns: Array of { id, name, ref, region, status }
      │
      ▼
Match by folder name:
  projectPath.split('/').pop().toLowerCase() === project.name.toLowerCase()
      │
      ├── Match found → setLinkedSupabaseProject(project)
      │                  updateTab(tabId, { supabaseLinkedProject: project })
      │
      └── No match → Show project picker UI
```

---

## Tab Switch Flow

### What Happens When User Clicks a Tab

```
User clicks tab
      │
      ▼
┌──────────────┐
│ tabs store   │  setActiveTab(newId)  [0.1-0.3ms]
│ activeTabId  │
└──────┬───────┘
       │
       │  Zustand notifies all subscribers (same JS tick)
       │
       ├──► Workspace.tsx ──► toggles visibility:hidden on TerminalViews
       │                      fires fit() after 100ms to resize terminal
       │
       ├──► App.tsx ──► useEffect [activeTabId]
       │    │           checks if project path changed
       │    │           if changed: setCurrentProject() + loadGallery()
       │    │           if same path: skips (prevProjectPathRef guard)
       │    │
       │    └──► project store update triggers NEXT render cycle:
       │         ├── ServiceIcons re-renders
       │         ├── StatusBar re-renders
       │         └── Various useEffects fire
       │
       ├──► useGitSync ──► useEffect [activeTabId]
       │    LOCAL refresh only (no network):
       │    • git:getProjectInfo → gets branch + remoteUrl [60-90ms]
       │    • Updates tab: worktreeBranch, gitRemoteConfigured
       │    • Parses remoteUrl → githubRepoName (persisted to TabState)
       │
       ├──► ServiceIcons ──► useLayoutEffect [currentProjectPath]
       │    FIRES BEFORE useEffect (critical for race prevention):
       │    • Bumps fetchGenRef (discards in-flight fetches from old tab)
       │    • Sets dropdownOpenRef.current = null (synchronous)
       │    • Calls setDropdownOpen(null) (async, for re-render)
       │
       ├──► ServiceIcons ──► useEffect [activeTabId]
       │    Loads cached integration state from tab store:
       │    • tab.githubRepoName → setRepoName() [instant]
       │    • tab.vercelLinkedProject → setLinkedProject() [instant]
       │    • tab.supabaseLinkedProject → setLinkedSupabaseProject() [instant]
       │
       ├──► ServiceIcons ──► Bootstrap effects (once per tab)
       │    Vercel/Supabase bootstraps SKIP (already in bootstrappedRef set)
       │    GitHub repo fetch re-runs (local, fast) and persists to TabState
       │
       └──► StatusBar ──► selectActiveTab selector
            Reads git state from NEW tab immediately
```

### Integration State During Tab Switch (After Fixes)

```
Tab switch: Tab A → Tab B
      │
      ├──► useLayoutEffect fires FIRST (same render, before useEffect):
      │    1. fetchGenRef.current++ (gen 5 → gen 6)
      │    2. dropdownOpenRef.current = null
      │    3. _setDropdownOpen(null) queued for next render
      │
      ├──► Cache load effect (useEffect [activeTabId]):
      │    Reads Tab B's persisted state from TabState:
      │    ├── githubRepoName: "owner/repo-b" → setRepoName()
      │    ├── vercelLinkedProject: { linked: true, ... } → setLinkedProject()
      │    └── supabaseLinkedProject: { id: "...", ... } → setLinkedSupabaseProject()
      │    UI updates instantly with cached data.
      │
      ├──► GitHub repo fetch (useEffect [status.github, path]):
      │    gen = 6 (captured at start)
      │    git:getProjectInfo(Tab B path) → parseRepoName → "owner/repo-b"
      │    gen check: fetchGenRef.current === 6? ✅ → persist + setRepoName
      │
      ├──► Vercel bootstrap (useEffect [status.vercel, path, activeTabId]):
      │    bootstrappedVercelRef.has("tab-b")? YES → skip entirely
      │    (No IPC call. No latency. No EBADF risk.)
      │
      ├──► Supabase bootstrap (useEffect [status.supabase, path, activeTabId]):
      │    bootstrappedSupabaseRef.has("tab-b")? YES → skip entirely
      │
      ├──► worktree:branches effect:
      │    dropdownOpenRef.current !== 'github' → BAIL (no IPC call)
      │    (Even if dropdown was open on Tab A, ref was set to null by layoutEffect)
      │
      └──► Vercel/Supabase dropdown effects:
           dropdownOpenRef.current !== 'vercel'/'supabase' → BAIL
```

### Race Prevention Mechanisms

Three mechanisms work together to prevent stale data and unnecessary IPC calls:

**1. Ref + State Mirror (`dropdownOpenRef`)**
```typescript
const dropdownOpenRef = useRef<string | null>(null)
const [dropdownOpen, _setDropdownOpen] = useState<string | null>(null)
const setDropdownOpen = useCallback((value: string | null) => {
  dropdownOpenRef.current = value  // Immediate (same tick)
  _setDropdownOpen(value)           // Async (next render)
}, [])
```
All fetch effects read from `dropdownOpenRef.current` (synchronous, always current) rather than `dropdownOpen` state (async, may be stale within the same render cycle).

**2. `useLayoutEffect` for Dropdown Close**
```typescript
useLayoutEffect(() => {
  if (currentProjectPath !== prevProjectPathRef.current) {
    prevProjectPathRef.current = currentProjectPath
    fetchGenRef.current += 1     // Invalidate in-flight fetches
    setDropdownOpen(null)         // Close via ref (sync) + state (async)
  }
}, [currentProjectPath])
```
`useLayoutEffect` fires before `useEffect` in the same render cycle. This guarantees that by the time any fetch effect runs, `dropdownOpenRef.current` is already `null` and `fetchGenRef` is bumped.

**3. Generation Counter (`fetchGenRef`)**
```typescript
const fetchGenRef = useRef(0)

// In useLayoutEffect (tab switch):
fetchGenRef.current += 1

// In every fetch effect:
const gen = fetchGenRef.current
someAsyncIpcCall().then((result) => {
  if (fetchGenRef.current !== gen) return  // Tab switched, discard
  // ... safe to update state
})
```
Discards stale responses from in-flight fetches that were started before a tab switch. The `worktree:branches` fetch also does a pre-IPC double-check (`Promise.resolve().then(() => { if (gen !== current) return })`) to catch rapid toggle scenarios.

**4. Once-Per-Tab Bootstrap Guards**
```typescript
const bootstrappedVercelRef = useRef(new Set<string>())
const bootstrappedSupabaseRef = useRef(new Set<string>())

// In bootstrap effects:
if (bootstrappedVercelRef.current.has(activeTabId)) return
bootstrappedVercelRef.current.add(activeTabId)
```
Prevents Vercel/Supabase bootstrap fetches from re-firing on every tab switch. Each tab gets bootstrapped exactly once. Subsequent switches load from TabState cache.

---

## Integration State Persistence

### What's Persisted in Tab Store (survives tab switch)

| Field | Source | Updated When |
|---|---|---|
| `worktreeBranch` | `useGitSync` local refresh | Tab switch + worktree creation |
| `gitAhead` / `gitBehind` | `useGitSync` network fetch | Window focus + 3-min interval |
| `gitRemoteConfigured` | `useGitSync` local refresh | Tab switch |
| `gitFetchError` | `useGitSync` network fetch | Window focus + 3-min interval |
| `lastFetchTime` | `useGitSync` network fetch | After each fetch |
| `lastPushTime` | Push handler | After push |
| `ptyId` | `usePty.connect` | Tab creation |
| `isDevServerRunning` | Dev server handlers | Start/stop |
| `previewUrl` | Dev server / MCP | Server ready |
| `mcpReady` / `mcpPort` | MCP bridge | Project opened |
| `githubRepoName` | `useGitSync` local + ServiceIcons fetch | Tab switch + link/create repo |
| `vercelLinkedProject` | ServiceIcons bootstrap + dropdown refresh | First load + dropdown open |
| `supabaseLinkedProject` | ServiceIcons bootstrap + dropdown refresh | First load + dropdown open |
| `lastIntegrationFetch` | Bootstrap effects | After successful fetch |

### Integration State Lifecycle

```
                    Tab Created
                        │
                        ▼
               All fields = null
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    useGitSync     Vercel Boot     Supabase Boot
    (local,fast)   (network,once)  (network,once)
         │              │              │
         ▼              ▼              ▼
   githubRepoName  vercelLinked   supabaseLinked
   persisted to    persisted to   persisted to
   TabState        TabState       TabState
         │              │              │
         └──────────────┼──────────────┘
                        │
                        ▼
              ┌── Tab Switch ──┐
              │                │
              ▼                ▼
         Cache Load       Bootstrap
         (instant)        SKIPS (Set guard)
              │
              ▼
         UI shows cached
         data immediately
              │
              ▼
         Dropdown Open?
         ├── Yes → Refresh from network (background)
         │         Update TabState on success
         └── No  → Stay with cached data
```

### What Triggers Writes to Integration Cache

| Action | Fields Updated |
|---|---|
| Tab switch (local git refresh) | `githubRepoName` |
| Vercel bootstrap (first load) | `vercelLinkedProject`, `lastIntegrationFetch` |
| Supabase bootstrap (first load) | `supabaseLinkedProject`, `lastIntegrationFetch` |
| GitHub repo fetch (status.github changes) | `githubRepoName` |
| Create new repo | `githubRepoName` (optimistic) |
| Link existing repo | `githubRepoName` (optimistic) |
| Vercel dropdown open (refresh) | `vercelLinkedProject`, `lastIntegrationFetch` |
| Supabase project selected | `supabaseLinkedProject` (optimistic) |
| Disconnect service | Clears the relevant field to `null` |

### What Stays Ephemeral (local `useState` in ServiceIcons)

These are transient UI state that doesn't need to survive tab switches:

| Field | Why Ephemeral |
|---|---|
| `currentBranch` / `localBranches` | Only relevant when GitHub dropdown is open |
| `prInfo` | Only shown in GitHub dropdown |
| `vercelProjects` (full list) | Only shown during "Link Project" flow |
| `supabaseProjects` (full list) | Only shown during project picker |
| `supabaseTables` / `Functions` / etc. | Only shown in expanded Supabase dropdown |
| `recentDeploys` | Only shown in Vercel dropdown |
| `dropdownOpen` | UI transient — always closes on tab switch |

---

## Challenges Encountered & Fixes

### Challenge 1: 5-10 Second Freeze on Tab Switch

**Symptom:** Window becomes unresponsive (spinning cursor) for 5-10 seconds when switching tabs.

**Root Cause:** `chokidar.close()` in the `fs:unwatch` IPC handler. The file watcher was torn down on every tab switch (because `useFileWatcher` had `currentProject.path` as a dependency). Chokidar's `close()` method scans all watched directories and takes 7-8 seconds on large projects. Since IPC handlers run on the Electron main process, this blocked ALL window events.

**How We Found It:** Added IPC timing instrumentation to the main process:
```typescript
const origHandle = ipcMain.handle.bind(ipcMain)
;(ipcMain as any).handle = (channel, listener) => {
  return origHandle(channel, async (...args) => {
    const t0 = performance.now()
    const result = await listener(...args)
    const elapsed = performance.now() - t0
    if (elapsed > 50) console.log(`SLOW IPC: ${channel} took ${elapsed.toFixed(0)}ms`)
    return result
  })
}
```
Output: `SLOW IPC: fs:unwatch took 7793ms` — immediately identified the bottleneck.

**Fix:**
- `useFileWatcher.ts`: Keep watchers alive across tab switches. Only swap IPC event listeners. Never call `fs:unwatch` on tab switch.
- `watcher.ts`: Make `chokidar.close()` fire-and-forget (non-blocking) so it can never freeze the main process even when called on tab close.

**Status:** ✅ Fixed. Tab switch now takes 0.1-0.3ms.

### Challenge 2: Cascading Zustand Re-renders

**Symptom:** `Workspace` re-rendered on every `updateTab()` call (git sync, token tracking, etc.), even when the update was for a background tab.

**Root Cause:** `useTabsStore((s) => s.tabs)` returns a new array reference on every store update because `updateTab` creates a new tabs array via `map()`.

**Fix:**
- `Workspace.tsx`: Created `useTabList()` memoized selector that only extracts `id` and `projectPath`, and only recomputes when tab count or IDs change.
- `tabs.ts`: Added early return guard in `setActiveTab` to skip redundant calls.

**Status:** ✅ Fixed. Workspace renders only when relevant data changes.

### Challenge 3: Claude Code Auth Prompt on Every Launch

**Symptom:** Claude Code asks the user to sign in every time the app launches.

**Root Cause:** `removeFromGlobalClaudeJson()` did a full read-modify-write of `~/.claude.json` on app close. This raced with Claude Code's own exit writes (session metrics, auth tokens). Since our write was NOT awaited before `app.quit()`, the last writer wins and auth data gets clobbered. Additionally, `removeMcpConfig()` was called TWICE on quit (from both `window-all-closed` and `before-quit`).

**Fix:**
- Removed `removeFromGlobalClaudeJson()` entirely. The stale MCP server entry in `~/.claude.json` is harmless (server won't respond when app is closed).
- On next launch, `writeMcpConfig()` overwrites with the correct port.
- Removed `claude mcp add` from terminal launch (was also racing with `writeGlobalClaudeJson`).

**Status:** ✅ Fixed.

### Challenge 4: `display:none` Destroying WebGL Contexts

**Symptom:** Terminal goes blank or flickers when switching tabs.

**Root Cause:** Using `display: none` for inactive terminals causes Chromium to release WebGL GPU contexts. When the terminal becomes visible again, the WebGL context must be recreated, which causes visual glitches and delays.

**Fix:** Changed to `visibility: hidden` with absolute positioning. The terminal stays in the rendering pipeline but is not visible, preserving the GPU context.

**Status:** ✅ Fixed.

### Challenge 5: `spawn EBADF` on Git Operations

**Symptom:** `worktree:branches` (and occasionally other git commands) fail with `Error: spawn EBADF`.

**Root Cause:** `EBADF` means "bad file descriptor." `node-pty` uses `forkpty()` which creates PTY master/slave file descriptors. These fds can leak into child processes spawned by `child_process.spawn` (used by simple-git). When the PTY state changes, the leaked fd becomes invalid for the child process.

This is NOT about running out of file descriptors (`EMFILE`) — it's about inherited fds becoming stale.

**Fixes Applied:**
- `git.ts`: Added `maxConcurrentProcesses: 3` to simple-git instances to reduce concurrent spawns.
- `worktree.ts`: All handlers now use cached `getGit()` instead of creating throwaway `simpleGit()` instances.
- `worktree.ts`: Added retry-once-on-EBADF logic with 300ms backoff.
- `ServiceIcons.tsx`: Pre-IPC gen double-check in `worktree:branches` fetch — bails before the IPC call if a tab switch happened. EBADF errors caught silently (transient fd races, not real failures).
- Eliminated unnecessary `worktree:branches` calls during tab switches (the main EBADF trigger) by closing dropdowns via `useLayoutEffect` + ref before fetch effects run.

**Status:** ⚠️ Mostly mitigated. EBADF can still occur if user explicitly opens GitHub dropdown and rapid-switches, but the pre-IPC gen check + server-side retry handle it. Root cause (node-pty fd leakage) remains — would require `CLOEXEC` on PTY fds or spawning git in a clean subprocess.

### Challenge 6: Integration State Race Condition

**Symptom:** `worktree:branches` fires on tab switch even when GitHub dropdown is closed. Vercel `linkedProject` and `deployments` calls fire on every tab switch.

**Root Cause:** React `useEffect` batching. When `currentProject?.path` changes (tab switch), multiple effects fire in the SAME render cycle:

1. **Dropdown close effect:** `setDropdownOpen(null)` — this is a `setState` call that only takes effect on the NEXT render.
2. **Worktree/Vercel/Supabase effects:** Read `dropdownOpen` — still see the OLD value from before the close.

**Fix (ref + state mirror + useLayoutEffect + gen counter):**

1. `dropdownOpenRef` mirrors `dropdownOpen` state synchronously. All fetch effects read from the ref, not state.
2. `useLayoutEffect` fires BEFORE `useEffect` in the same render — closes dropdown and bumps gen counter before any fetch effect runs.
3. Generation counter (`fetchGenRef`) incremented on tab switch, checked in all async callbacks to discard stale responses.

```typescript
// Ref + state mirror (sync + async)
const dropdownOpenRef = useRef<string | null>(null)
const [dropdownOpen, _setDropdownOpen] = useState<string | null>(null)
const setDropdownOpen = useCallback((value: string | null) => {
  dropdownOpenRef.current = value  // Sync (same tick)
  _setDropdownOpen(value)           // Async (next render)
}, [])

// useLayoutEffect fires BEFORE useEffect
useLayoutEffect(() => {
  if (currentProjectPath !== prevProjectPathRef.current) {
    fetchGenRef.current += 1      // Invalidate in-flight fetches
    setDropdownOpen(null)           // Closes via ref before effects run
  }
}, [currentProjectPath])

// Fetch effects read ref (always current):
useEffect(() => {
  if (dropdownOpenRef.current !== 'github') return  // Safe — ref is updated
  const gen = fetchGenRef.current
  worktree.branches(path).then((result) => {
    if (fetchGenRef.current !== gen) return  // Stale — discard
    // ... update state
  })
}, [dropdownOpen, ...])
```

**Status:** ✅ Fixed. No unnecessary IPC calls during tab switches.

### Challenge 7: Integration State Resets on Tab Switch

**Symptom:** User opens GitHub dropdown, selects "Link Repo," then switches tabs. When they switch back, the link repo selection is gone. Vercel and Supabase linked status resets to "Unlinked."

**Root Cause:** Integration state (linked repo, linked Vercel project, linked Supabase project) was stored in `useState` inside `ServiceIcons`. This state was ephemeral — it got re-fetched (and overwritten with null) whenever `currentProject?.path` changed.

**Fix (integration cache in TabState):**

Added flat fields to `TabState`:
```typescript
interface TabState {
  // ... existing fields ...
  githubRepoName: string | null
  vercelLinkedProject: any | null
  supabaseLinkedProject: any | null
  lastIntegrationFetch: number | null
}
```

On tab switch: `useEffect([activeTabId])` loads cached values from tab store instantly.
After fetches: `updateTab()` persists results to tab store.
On link/create/disconnect: optimistic `updateTab()` immediately.

**Status:** ✅ Fixed. Integration state survives tab switches.

### Challenge 8: Integrations Not Detected on First Project Load

**Symptom:** GitHub repo, Vercel project, and Supabase project not shown when a tab is first created or after app restart. User must open the dropdown manually to trigger detection.

**Root Cause:** Integration state starts as `null` in TabState defaults. Detection previously only ran when the relevant dropdown was opened (lazy fetch pattern). No bootstrap fetch ran on project load.

**Fix (per-integration bootstrap on load):**

- **GitHub:** `useGitSync` already fetches `remoteUrl` on every tab switch. Added `parseRepoName()` to extract `owner/repo` and persist to `tab.githubRepoName`. Runs on every switch (local, fast, ~60ms). No OAuth dependency.

- **Vercel:** Added bootstrap effect in `ServiceIcons` that runs once per tab (tracked by `vercelBootstrapped` in Zustand). Calls `oauth:vercel:linkedProject()` in background (~400ms), persists result to TabState. Subsequent switches load from cache.

- **Supabase:** Same pattern as Vercel. Bootstrap effect calls `oauth:supabase:listProjects()`, matches by folder name, persists to TabState. Once per tab.

**Guards against re-fetch spam:**
```typescript
// Stored in Zustand TabState (survives React StrictMode remounts)
if (tab.vercelBootstrapped) return  // Already done
useTabsStore.getState().updateTab(tabId, { vercelBootstrapped: true })
// ... fetch and persist
```

**Status:** ✅ Fixed. All three integrations auto-detect on first load.

### Challenge 9: Bootstrap Effects Capture Wrong Project Path

**Symptom:** After switching tabs A→B, Vercel/Supabase bootstrap fetches use tab A's project path but store results under tab B. GitHub repo name goes null after repeated switches.

**Root Cause:** Two stores update at different times during a tab switch:
- `useTabsStore.activeTabId` updates **immediately** (in click handler)
- `useProjectStore.currentProject` updates **one render later** (via App.tsx useEffect)

Effects that depend on both see inconsistent state: new `activeTabId` but old `currentProject.path`.

```
Render 1: activeTabId = B, currentProject = A (STALE!)
Render 2: activeTabId = B, currentProject = B (correct)
```

**Fix:** All fetch effects now read project path from the tab store (`tab.project.path`) instead of the project store (`currentProject.path`). The tab store is the single source of truth and updates atomically with `activeTabId`.

```typescript
// BEFORE (broken): read from project store (delayed by one render)
const capturedPath = currentProject.path  // ← stale during tab switch!

// AFTER (fixed): read from tab store (atomic)
const tab = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
const tabPath = tab.project.path  // ← always correct
```

Effects updated:
- `useLayoutEffect` gen bump: triggers on `activeTabId` (not `currentProjectPath`)
- GitHub repo fetch: uses `tab.project.path`
- Vercel bootstrap: uses `tab.project.path`
- Supabase bootstrap: uses `tab.project.path`
- Worktree/branches + PR fetch: uses `tab.project.path`

**Status:** ✅ Fixed.

### Challenge 10: Bootstrap "Done" Flag Set Too Early + GitHub State Overwritten

**Symptom:** (a) Vercel/Supabase bootstrap skips with `cached=null` after tab switches. (b) GitHub repo name goes from a known-good value to "none" after rapid switching.

**Root Cause (a):** `vercelBootstrapped: true` was set at fetch START (optimistic). If the fetch response was discarded (gen changed during tab switch), the flag stayed true. Next switch back saw "already done" and skipped — permanently stuck with no data.

**Root Cause (b):** `getProjectInfo` can return `remoteUrl: null` from transient git read failures (stale fd, EBADF). The GitHub fetch effect treated this as "definitely no repo" and overwrote the known-good cached value with null.

**Fix (a) — Mark done on successful apply only:**
```typescript
// BEFORE: mark at fetch start (broken)
useTabsStore.getState().updateTab(tabId, { vercelBootstrapped: true })
// ... fetch that might get discarded → flag stays true, tab stuck

// AFTER: mark only when response is successfully applied
window.api.oauth.vercel.linkedProject(...).then((result) => {
  if (fetchGenRef.current !== gen) return  // discarded → flag stays FALSE → will retry
  useTabsStore.getState().updateTab(tabId, {
    vercelBootstrapped: true,  // done only here
    vercelLinkedProject: result,
  })
}).catch(() => { /* error → flag stays FALSE → will retry */ })
```

Inflight dedup via component ref (`vercelInflightRef`, `supabaseInflightRef`) keyed by `${tabId}:${path}` prevents duplicate concurrent fetches without blocking retries after discard.

**Fix (b) — Never overwrite known-good with null:**
```typescript
// If git returns no remote but we have a cached repo name, keep it
if (!name) {
  const cached = useTabsStore.getState().tabs.find((t) => t.id === tabId)
  if (cached?.githubRepoName) {
    setRepoName(cached.githubRepoName)  // restore cached
    return  // don't persist null
  }
}
```

Same principle in `useGitSync`: only upgrade values (`null→value`, `value→different`), never downgrade (`value→null`).

**Status:** ✅ Fixed.

---

## File Reference

| File | Role |
|---|---|
| `src/renderer/stores/tabs.ts` | Tab state management, setActiveTab, updateTab, integration cache fields |
| `src/renderer/App.tsx` | Syncs activeTab → currentProject on tab switch |
| `src/renderer/hooks/useGitSync.ts` | Local git refresh (tab switch) + network fetch (interval) + GitHub repo bootstrap |
| `src/renderer/hooks/useFileWatcher.ts` | Chokidar watcher lifecycle (kept alive across switches) |
| `src/renderer/hooks/usePty.ts` | PTY creation, Claude Code launch |
| `src/renderer/components/Workspace/Workspace.tsx` | Terminal visibility toggle, canvas layout |
| `src/renderer/components/Terminal/TerminalView.tsx` | xterm.js instance, WebGL, fit addon |
| `src/renderer/components/ServiceIcons/ServiceIcons.tsx` | GitHub/Vercel/Supabase integration UI, bootstrap effects, race guards |
| `src/renderer/components/StatusBar/StatusBar.tsx` | Git sync indicators, dev server controls |
| `src/main/watcher.ts` | Chokidar file watcher (main process) |
| `src/main/services/git.ts` | Git operations, cached instances, concurrency limit |
| `src/main/services/worktree.ts` | Git worktree operations, branch listing, EBADF retry |
| `src/main/mcp/config-writer.ts` | MCP server registration (project-local only, never touches ~/.claude.json) |
| `src/main/index.ts` | IPC handler setup, app lifecycle, cleanup |

---

## Debug Instrumentation (to be removed)

The following debug logging was added during this investigation and should be removed once all issues are resolved:

- `[TAB-DEBUG]` prefix across all files
- IPC timing instrumentation in `src/main/index.ts` (monkey-patched `ipcMain.handle`)
- `console-message` forwarding in `src/main/index.ts` (forwards renderer logs to main process stdout)
- Workspace render timing (`performance.now()`) in `Workspace.tsx`
- `setActiveTab` timing in `tabs.ts`
- fit() dimension logging in `TerminalView.tsx`
