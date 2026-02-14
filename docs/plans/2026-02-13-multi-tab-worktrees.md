# Multi-Tab Worktree Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-project workspace with a tab bar where each tab is an independent project/worktree with its own terminal, canvas, dev server, and git context — enabling parallel feature development.

**Architecture:** A new `TabsStore` manages an array of tab state objects. Each tab owns its own PTY, canvas state, gallery, and dev server reference. Main process singletons (git, dev server, file watcher) become Maps keyed by project path. MCP events are routed to the correct tab via project path metadata. The "+" button offers three flows: new worktree+branch, existing branch, or different project.

**Tech Stack:** Zustand (tab store), React 19 (tab bar UI), xterm.js 5 (multiple terminals), node-pty (multiple PTYs), simple-git (per-project instances), Framer Motion (tab animations), Tailwind 4

---

## Phase 1: Tab Store Foundation

### Task 1: Create TabsStore

**Files:**
- Create: `src/renderer/stores/tabs.ts`
- Modify: `src/renderer/stores/project.ts:17-41`
- Test: `src/renderer/__tests__/tabs-store.test.ts`

**Step 1: Write the test**

```typescript
// src/renderer/__tests__/tabs-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTabsStore } from '../stores/tabs'

describe('TabsStore', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('starts with no tabs', () => {
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toEqual([])
    expect(activeTabId).toBeNull()
  })

  it('adds a tab and sets it active', () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'TestCanvas', path: '/Users/test/TestCanvas' })
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toHaveLength(1)
    expect(activeTabId).toBe(tabs[0].id)
    expect(tabs[0].project.name).toBe('TestCanvas')
  })

  it('switches active tab', () => {
    const { addTab, setActiveTab } = useTabsStore.getState()
    addTab({ name: 'Project1', path: '/p1' })
    addTab({ name: 'Project2', path: '/p2' })
    const { tabs } = useTabsStore.getState()
    setActiveTab(tabs[1].id)
    expect(useTabsStore.getState().activeTabId).toBe(tabs[1].id)
  })

  it('closes a tab and activates neighbor', () => {
    const { addTab, closeTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    addTab({ name: 'P2', path: '/p2' })
    const { tabs } = useTabsStore.getState()
    const id0 = tabs[0].id
    const id1 = tabs[1].id
    useTabsStore.getState().setActiveTab(id0)
    closeTab(id0)
    expect(useTabsStore.getState().activeTabId).toBe(id1)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })

  it('returns to project picker when last tab closed', () => {
    const { addTab, closeTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    const { tabs } = useTabsStore.getState()
    closeTab(tabs[0].id)
    expect(useTabsStore.getState().tabs).toHaveLength(0)
    expect(useTabsStore.getState().activeTabId).toBeNull()
  })

  it('tracks per-tab state independently', () => {
    const { addTab, updateTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    addTab({ name: 'P2', path: '/p2' })
    const { tabs } = useTabsStore.getState()
    updateTab(tabs[0].id, { isDevServerRunning: true, previewUrl: 'http://localhost:3000' })
    updateTab(tabs[1].id, { isDevServerRunning: false })
    const state = useTabsStore.getState()
    expect(state.tabs[0].isDevServerRunning).toBe(true)
    expect(state.tabs[0].previewUrl).toBe('http://localhost:3000')
    expect(state.tabs[1].isDevServerRunning).toBe(false)
    expect(state.tabs[1].previewUrl).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/renderer/__tests__/tabs-store.test.ts`
Expected: FAIL — module `../stores/tabs` not found

**Step 3: Implement TabsStore**

```typescript
// src/renderer/stores/tabs.ts
import { create } from 'zustand'
import type { ProjectInfo } from './project'
import type { CanvasTab } from './canvas'
import type { GalleryVariant } from './gallery'
import type { ElementContext } from './canvas'
import type { WorkspaceMode } from './workspace'

export interface TabState {
  id: string
  project: ProjectInfo
  // Terminal
  ptyId: string | null
  // Dev server
  isDevServerRunning: boolean
  // Canvas
  previewUrl: string | null
  activeCanvasTab: CanvasTab
  inspectorActive: boolean
  viewportMode: 'desktop' | 'mobile'
  selectedElements: ElementContext[]
  screenshotMode: boolean
  // Gallery
  galleryVariants: GalleryVariant[]
  gallerySelectedId: string | null
  // Git diff
  diffBeforeHash: string | null
  diffAfterHash: string | null
  // Workspace layout
  workspaceMode: WorkspaceMode
  // MCP
  mcpReady: boolean
  mcpPort: number | null
  // Worktree info (null = main working tree)
  worktreeBranch: string | null
  worktreePath: string | null
}

function createDefaultTabState(project: ProjectInfo): TabState {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    project,
    ptyId: null,
    isDevServerRunning: false,
    previewUrl: null,
    activeCanvasTab: 'preview',
    inspectorActive: false,
    viewportMode: 'desktop',
    selectedElements: [],
    screenshotMode: false,
    galleryVariants: [],
    gallerySelectedId: null,
    diffBeforeHash: null,
    diffAfterHash: null,
    workspaceMode: 'terminal-only',
    mcpReady: false,
    mcpPort: null,
    worktreeBranch: null,
    worktreePath: null,
  }
}

interface TabsStore {
  tabs: TabState[]
  activeTabId: string | null

  addTab: (project: ProjectInfo) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, partial: Partial<TabState>) => void
  getActiveTab: () => TabState | null
  reset: () => void
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (project) => {
    const tab = createDefaultTabState(project)
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    return tab.id
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const newTabs = s.tabs.filter((t) => t.id !== id)
      let newActive = s.activeTabId
      if (s.activeTabId === id) {
        // Activate neighbor: prefer right, then left, then null
        const neighbor = newTabs[idx] || newTabs[idx - 1] || null
        newActive = neighbor?.id || null
      }
      return { tabs: newTabs, activeTabId: newActive }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, partial) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    }))
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) || null
  },

  reset: () => set({ tabs: [], activeTabId: null }),
}))
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/renderer/__tests__/tabs-store.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/renderer/stores/tabs.ts src/renderer/__tests__/tabs-store.test.ts
git commit -m "feat: add TabsStore for multi-tab state management"
```

---

### Task 2: Create TabBar Component

**Files:**
- Create: `src/renderer/components/TabBar/TabBar.tsx`
- Modify: `src/renderer/App.tsx:53-65` (add TabBar above workspace)

**Step 1: Create TabBar component**

```typescript
// src/renderer/components/TabBar/TabBar.tsx
import { useTabsStore, TabState } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { GitBranch, X, Plus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useCallback } from 'react'

function Tab({ tab, isActive, onActivate, onClose }: {
  tab: TabState
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  const branchLabel = tab.worktreeBranch || 'main'

  return (
    <motion.button
      layout
      onClick={onActivate}
      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-white/5 transition-colors shrink-0 max-w-[200px] ${
        isActive
          ? 'bg-[var(--bg-primary)] text-white/90'
          : 'bg-[var(--bg-secondary)] text-white/40 hover:text-white/60 hover:bg-white/5'
      }`}
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: 'auto' }}
      exit={{ opacity: 0, width: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* Active indicator */}
      {isActive && (
        <motion.div
          layoutId="tab-indicator"
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-cyan)]"
        />
      )}

      <span className="truncate">{tab.project.name}</span>
      <span className="text-[10px] text-white/20 shrink-0">
        <GitBranch size={9} className="inline -mt-px" /> {branchLabel}
      </span>

      {/* Close button */}
      <span
        onClick={onClose}
        className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
      >
        <X size={10} />
      </span>
    </motion.button>
  )
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore()
  const [showNewTabMenu, setShowNewTabMenu] = useState(false)

  const handleClose = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }, [closeTab])

  const handleNewTab = useCallback(() => {
    // For now, go to project picker
    useProjectStore.getState().setScreen('project-picker')
  }, [])

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center bg-[var(--bg-secondary)] border-b border-white/5 no-drag">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => setActiveTab(tab.id)}
            onClose={(e) => handleClose(e, tab.id)}
          />
        ))}
      </AnimatePresence>

      {/* New tab button */}
      <button
        onClick={handleNewTab}
        className="p-1.5 mx-1 rounded hover:bg-white/10 text-white/25 hover:text-white/50 transition-colors shrink-0"
        title="New tab"
      >
        <Plus size={12} />
      </button>
    </div>
  )
}
```

**Step 2: Add TabBar to App.tsx**

In `src/renderer/App.tsx`, add `TabBar` import and render it above the workspace:

```typescript
import { TabBar } from './components/TabBar/TabBar'

// In the return JSX, after TitleBar, before the flex-1 container:
<TitleBar />
{screen === 'workspace' && <TabBar />}
<div className="flex-1 overflow-hidden">
```

**Step 3: Run the build to verify no errors**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: All three bundles build successfully

**Step 4: Commit**

```bash
git add src/renderer/components/TabBar/TabBar.tsx src/renderer/App.tsx
git commit -m "feat: add TabBar component with tab switching UI"
```

---

### Task 3: Wire Project Opening to TabsStore

**Files:**
- Modify: `src/renderer/components/Onboarding/ProjectPicker.tsx` (openProject creates tab)
- Modify: `src/renderer/App.tsx` (workspace reads active tab, not currentProject)
- Modify: `src/renderer/stores/project.ts` (keep for screen routing, remove per-tab state)

**Step 1: Update ProjectPicker to create tab on project open**

In `src/renderer/components/Onboarding/ProjectPicker.tsx`, find the `openProject` function and add tab creation:

```typescript
import { useTabsStore } from '@/stores/tabs'

// Inside openProject():
const tabId = useTabsStore.getState().addTab(project)
// Keep existing: setCurrentProject(project), setScreen('workspace')
```

**Step 2: Update App.tsx MCP lifecycle to read from TabsStore**

In `src/renderer/App.tsx`, update the MCP useEffect to read from the active tab:

```typescript
import { useTabsStore } from './stores/tabs'

// Replace currentProject?.path with active tab's project path:
const activeTab = useTabsStore((s) => s.getActiveTab())
const projectPath = activeTab?.project.path || currentProject?.path

useEffect(() => {
  if (screen === 'workspace' && projectPath) {
    window.api.mcp.projectOpened(projectPath).then(({ port }) => {
      useProjectStore.getState().setMcpReady(true, port)
      if (activeTab) {
        useTabsStore.getState().updateTab(activeTab.id, { mcpReady: true, mcpPort: port })
      }
    })
    return () => {
      window.api.mcp.projectClosed()
      useProjectStore.getState().setMcpReady(false)
    }
  }
}, [screen, projectPath])
```

**Step 3: Run build + test**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build success

**Step 4: Commit**

```bash
git add src/renderer/components/Onboarding/ProjectPicker.tsx src/renderer/App.tsx
git commit -m "feat: wire project opening to TabsStore, tabs now drive workspace"
```

---

### Task 4: Update StatusBar to Show Active Tab Info

**Files:**
- Modify: `src/renderer/components/StatusBar/StatusBar.tsx` (read from active tab)

**Step 1: Update StatusBar to read from TabsStore**

Replace the project name and branch display to read from the active tab:

```typescript
import { useTabsStore } from '@/stores/tabs'

// Inside StatusBar():
const activeTab = useTabsStore((s) => s.getActiveTab())
const projectName = activeTab?.project.name || currentProject?.name
const branchName = activeTab?.worktreeBranch || 'main'
```

Remove the switchProject button entirely (tabs handle navigation now). Replace with just the project name display (non-clickable since tabs are above).

**Step 2: Remove exit overlay** (tabs handle this now via close button)

Remove `exitSteps` state, the `switchProject` callback, and the exit overlay portal from StatusBar. The tab close button in TabBar will handle project switching.

**Step 3: Run build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build success

**Step 4: Commit**

```bash
git add src/renderer/components/StatusBar/StatusBar.tsx
git commit -m "refactor: StatusBar reads from active tab, remove project switcher"
```

---

## Phase 2: Per-Tab State Scoping

### Task 5: Create useTabState Hook

**Files:**
- Create: `src/renderer/hooks/useTabState.ts`
- Test: `src/renderer/__tests__/use-tab-state.test.ts`

**Step 1: Implement the hook**

```typescript
// src/renderer/hooks/useTabState.ts
import { useTabsStore, TabState } from '@/stores/tabs'
import { useCallback } from 'react'

/**
 * Returns the active tab's state and a scoped updater.
 * Components use this instead of direct store access for per-tab state.
 */
export function useTabState() {
  const activeTab = useTabsStore((s) => {
    const id = s.activeTabId
    return id ? s.tabs.find((t) => t.id === id) || null : null
  })

  const update = useCallback((partial: Partial<TabState>) => {
    const id = useTabsStore.getState().activeTabId
    if (id) useTabsStore.getState().updateTab(id, partial)
  }, [])

  return { tab: activeTab, update }
}

/**
 * Selector for specific tab fields (optimized re-renders).
 */
export function useActiveTabField<K extends keyof TabState>(field: K): TabState[K] | undefined {
  return useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab?.[field]
  })
}
```

**Step 2: Run build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build success

**Step 3: Commit**

```bash
git add src/renderer/hooks/useTabState.ts
git commit -m "feat: add useTabState hook for per-tab state access"
```

---

### Task 6: Scope CanvasPanel to Active Tab

**Files:**
- Modify: `src/renderer/components/Canvas/CanvasPanel.tsx` (read from tab state)
- Modify: `src/renderer/hooks/useMcpCommands.ts` (write to tab state)

**Step 1: Update CanvasPanel to read from active tab**

Replace direct `useCanvasStore` reads with `useTabState`:

```typescript
import { useTabState, useActiveTabField } from '@/hooks/useTabState'

// Replace:
//   const { activeTab, previewUrl, ... } = useCanvasStore()
// With:
const activeCanvasTab = useActiveTabField('activeCanvasTab') || 'preview'
const previewUrl = useActiveTabField('previewUrl')
const screenshotMode = useActiveTabField('screenshotMode') || false
const viewportMode = useActiveTabField('viewportMode') || 'desktop'
const { update } = useTabState()

// Replace setActiveTab(tab) with:
update({ activeCanvasTab: tab })
```

Keep `useCanvasStore` for inspector state that needs to work across the app (selectedElements, inspectorActive). These will be migrated to tab state in a later task.

**Step 2: Update useMcpCommands to write to active tab**

In `src/renderer/hooks/useMcpCommands.ts`, update the MCP event handlers to write to the active tab's state instead of the global canvas store:

```typescript
import { useTabsStore } from '@/stores/tabs'

// Helper to update active tab
const updateActiveTab = (partial: Partial<TabState>) => {
  const { activeTabId, updateTab } = useTabsStore.getState()
  if (activeTabId) updateTab(activeTabId, partial)
}

// In onStartPreview handler, replace:
//   useCanvasStore.getState().setPreviewUrl(url)
// With:
updateActiveTab({ previewUrl: url, isDevServerRunning: true })
```

**Step 3: Run build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build success

**Step 4: Commit**

```bash
git add src/renderer/components/Canvas/CanvasPanel.tsx src/renderer/hooks/useMcpCommands.ts
git commit -m "feat: scope canvas state to active tab"
```

---

### Task 7: Scope Terminal to Active Tab

**Files:**
- Modify: `src/renderer/hooks/usePty.ts` (store ptyId in tab state)
- Modify: `src/renderer/components/Terminal/TerminalView.tsx` (support tab switching)
- Modify: `src/renderer/components/Workspace/Workspace.tsx` (pass tabId to TerminalView)

**Step 1: Update usePty to store ptyId in tab state**

When a PTY is spawned, store its ID in the active tab:

```typescript
import { useTabsStore } from '@/stores/tabs'

// In connect(), after spawn:
const id = await window.api.pty.spawn(undefined, cwd)
const activeTabId = useTabsStore.getState().activeTabId
if (activeTabId) {
  useTabsStore.getState().updateTab(activeTabId, { ptyId: id })
}
```

**Step 2: Update TerminalView to accept tabId**

Add `tabId` prop to TerminalView. When `tabId` changes (tab switch), detach the old terminal and attach the new one. Key insight: xterm.js `Terminal` instances can be detached from a DOM element and reattached — we keep one Terminal per tab in a `Map<tabId, Terminal>`.

```typescript
interface TerminalViewProps {
  cwd?: string
  tabId: string
  autoLaunchClaude?: boolean
}
```

Store `Terminal` instances in a module-level Map:

```typescript
const terminals = new Map<string, Terminal>()

// On mount: check if terminal exists for this tabId
// If yes: reattach to container div
// If no: create new Terminal, store in map, connect PTY
```

**Step 3: Update Workspace to pass active tabId**

```typescript
const activeTabId = useTabsStore((s) => s.activeTabId)
// ...
<TerminalView cwd={activeTab?.project.path} tabId={activeTabId!} autoLaunchClaude />
```

**Step 4: Run build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build success

**Step 5: Commit**

```bash
git add src/renderer/hooks/usePty.ts src/renderer/components/Terminal/TerminalView.tsx src/renderer/components/Workspace/Workspace.tsx
git commit -m "feat: scope terminal/PTY to active tab, support tab switching"
```

---

## Phase 3: Main Process Maps

### Task 8: Refactor Git Service to Per-Project Instances

**Files:**
- Modify: `src/main/services/git.ts` (Map instead of singleton)
- Modify: `src/preload/index.ts` (add projectPath param to git methods)

**Step 1: Replace singleton with Map**

```typescript
// src/main/services/git.ts
const gitInstances = new Map<string, SimpleGit>()

function getGit(projectPath: string): SimpleGit {
  if (!gitInstances.has(projectPath)) {
    gitInstances.set(projectPath, simpleGit(projectPath))
  }
  return gitInstances.get(projectPath)!
}
```

**Step 2: Update all handlers to accept projectPath**

Each handler changes from using global `git` to `getGit(projectPath)`:

```typescript
ipcMain.handle('git:status', async (_event, projectPath: string) => {
  return getGit(projectPath).status()
})

ipcMain.handle('git:log', async (_event, projectPath: string, maxCount?: number) => {
  const log = await getGit(projectPath).log({ maxCount: maxCount || 20 })
  return log.all.map(...)
})

// Same pattern for: git:branch, git:checkpoint, git:diff, git:diffBetween, git:show, git:remoteUrl
```

Keep `git:getProjectInfo` and `git:setRemote` as-is (they already accept cwd).

**Step 3: Update preload bridge**

Add `projectPath` as first param to git methods that currently don't have it:

```typescript
git: {
  status: (projectPath: string) => ipcRenderer.invoke('git:status', projectPath),
  branch: (projectPath: string) => ipcRenderer.invoke('git:branch', projectPath),
  log: (projectPath: string, maxCount?: number) => ipcRenderer.invoke('git:log', projectPath, maxCount),
  checkpoint: (projectPath: string, message: string) => ipcRenderer.invoke('git:checkpoint', projectPath, message),
  diff: (projectPath: string, hash?: string) => ipcRenderer.invoke('git:diff', projectPath, hash),
  // ... etc
}
```

**Step 4: Update renderer callers**

Search for all `window.api.git.*` calls in renderer and add the project path parameter. Key files:
- `src/renderer/components/CheckpointTimeline/Timeline.tsx`
- `src/renderer/hooks/useMcpCommands.ts`
- `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 5: Run build + tests**

Run: `npm test -- --run && npx electron-vite build 2>&1 | tail -5`
Expected: Tests pass, build success

**Step 6: Commit**

```bash
git add src/main/services/git.ts src/preload/index.ts src/renderer/
git commit -m "refactor: git service uses per-project instances instead of singleton"
```

---

### Task 9: Refactor Dev Server to Per-Project Map

**Files:**
- Modify: `src/main/services/dev-server.ts` (Map<string, ChildProcess>)
- Modify: `src/preload/index.ts` (dev events include projectPath)

**Step 1: Replace singleton with Map**

```typescript
// src/main/services/dev-server.ts
const devProcesses = new Map<string, ChildProcess>()

// dev:start handler — key by cwd
ipcMain.handle('dev:start', async (_event, cwd: string, command?: string) => {
  if (devProcesses.has(cwd)) return { error: 'Dev server already running for this project' }
  // ... spawn process
  devProcesses.set(cwd, child)
  // Include cwd in IPC events:
  child.stdout?.on('data', (data) => {
    win.webContents.send('dev:output', { cwd, data: data.toString() })
  })
})

// dev:stop handler — stop specific project or all
ipcMain.handle('dev:stop', async (_event, cwd?: string) => {
  if (cwd && devProcesses.has(cwd)) {
    treeKill(devProcesses.get(cwd)!.pid!, 'SIGTERM')
    devProcesses.delete(cwd)
  } else if (!cwd) {
    // Stop all (app shutdown)
    for (const [key, proc] of devProcesses) {
      treeKill(proc.pid!, 'SIGTERM')
      devProcesses.delete(key)
    }
  }
})
```

**Step 2: Update preload dev events to include cwd**

```typescript
dev: {
  start: (cwd: string, command?: string) => ipcRenderer.invoke('dev:start', cwd, command),
  stop: (cwd?: string) => ipcRenderer.invoke('dev:stop', cwd),
  onOutput: (cb: (data: { cwd: string; data: string }) => void) => { ... },
  onStatus: (cb: (status: { cwd: string; stage: string; message: string; url?: string }) => void) => { ... },
}
```

**Step 3: Update renderer callers to filter by active tab's project path**

In `useMcpCommands.ts` and `StatusBar.tsx`, filter dev server events by matching `cwd` to active tab's `project.path`.

**Step 4: Run build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build success

**Step 5: Commit**

```bash
git add src/main/services/dev-server.ts src/preload/index.ts src/renderer/
git commit -m "refactor: dev server uses per-project Map, supports concurrent servers"
```

---

### Task 10: Refactor File Watcher to Per-Project Map

**Files:**
- Modify: `src/main/watcher.ts` (Map<string, FSWatcher>)

**Step 1: Replace singleton with Map**

```typescript
const watchers = new Map<string, FSWatcher>()

ipcMain.handle('fs:watch', (_event, projectPath: string) => {
  if (watchers.has(projectPath)) return // Already watching
  const w = watch(projectPath, { ignored: [...], ignoreInitial: true })
  w.on('change', (path) => win.webContents.send('fs:change', { projectPath, path }))
  w.on('add', (path) => win.webContents.send('fs:add', { projectPath, path }))
  w.on('unlink', (path) => win.webContents.send('fs:unlink', { projectPath, path }))
  watchers.set(projectPath, w)
})

ipcMain.handle('fs:unwatch', (_event, projectPath?: string) => {
  if (projectPath && watchers.has(projectPath)) {
    watchers.get(projectPath)!.close()
    watchers.delete(projectPath)
  } else if (!projectPath) {
    for (const [, w] of watchers) w.close()
    watchers.clear()
  }
})
```

**Step 2: Update preload and renderer to include projectPath in events**

**Step 3: Commit**

```bash
git add src/main/watcher.ts src/preload/index.ts
git commit -m "refactor: file watcher uses per-project Map"
```

---

## Phase 4: MCP Event Routing

### Task 11: Add Project Context to MCP Events

**Files:**
- Modify: `src/main/mcp/tools.ts` (include projectPath in IPC sends)
- Modify: `src/main/mcp/server.ts` (track projectPath per session)
- Modify: `src/renderer/hooks/useMcpCommands.ts` (filter events by active tab)

**Step 1: Track projectPath per MCP session**

In `src/main/mcp/server.ts`, store `projectPath` when session is created:

```typescript
sessions[sessionId] = { server, transport, projectPath }
```

Pass `projectPath` to tool handlers in `tools.ts`.

**Step 2: Include projectPath in all IPC events from tools**

```typescript
// tools.ts — every webContents.send() includes projectPath:
win.webContents.send('mcp:canvas-render', { projectPath, html, css })
win.webContents.send('mcp:start-preview', { projectPath, command, cwd })
// ... etc for all events
```

**Step 3: Filter events in useMcpCommands by active tab**

```typescript
window.api.mcp.onCanvasRender(({ projectPath, html, css }) => {
  const activeTab = useTabsStore.getState().getActiveTab()
  if (!activeTab || activeTab.project.path !== projectPath) return
  // ... handle event
})
```

**Step 4: Commit**

```bash
git add src/main/mcp/ src/renderer/hooks/useMcpCommands.ts
git commit -m "feat: MCP events include projectPath, routed to correct tab"
```

---

## Phase 5: Multi-Tab Terminal Management

### Task 12: Terminal Instance Pool

**Files:**
- Create: `src/renderer/services/terminalPool.ts`
- Modify: `src/renderer/components/Terminal/TerminalView.tsx`

**Step 1: Create terminal pool**

```typescript
// src/renderer/services/terminalPool.ts
import { Terminal } from '@xterm/xterm'

const pool = new Map<string, { terminal: Terminal; element: HTMLDivElement | null }>()

export function getOrCreateTerminal(tabId: string, options: ITerminalOptions): Terminal {
  if (pool.has(tabId)) return pool.get(tabId)!.terminal
  const terminal = new Terminal(options)
  pool.set(tabId, { terminal, element: null })
  return terminal
}

export function attachTerminal(tabId: string, container: HTMLDivElement): void {
  const entry = pool.get(tabId)
  if (!entry) return
  if (entry.element === container) return // Already attached
  entry.terminal.open(container)
  entry.element = container
}

export function detachTerminal(tabId: string): void {
  // xterm doesn't support detach natively — we hide the container instead
  const entry = pool.get(tabId)
  if (entry?.element) {
    entry.element.style.display = 'none'
  }
}

export function destroyTerminal(tabId: string): void {
  const entry = pool.get(tabId)
  if (entry) {
    entry.terminal.dispose()
    pool.delete(tabId)
  }
}
```

**Step 2: Update TerminalView to use pool**

TerminalView renders all tab terminals in the same container, showing only the active one. When tab switches, hide old terminal's DOM element, show new one.

**Step 3: Commit**

```bash
git add src/renderer/services/terminalPool.ts src/renderer/components/Terminal/TerminalView.tsx
git commit -m "feat: terminal pool manages multiple xterm instances for tab switching"
```

---

## Phase 6: Tab Close with Cleanup Animation

### Task 13: Tab Close Animation

**Files:**
- Modify: `src/renderer/components/TabBar/TabBar.tsx` (close confirmation + cleanup)

**Step 1: Add close handler with cleanup steps**

When closing a tab, show the exit overlay (moved from StatusBar) with cleanup steps:
- Stopping dev server (if running)
- Detaching PTY session
- Closing MCP bridge
- Cleaning up file watcher

Then remove the tab from the store.

```typescript
const handleCloseTab = useCallback(async (tabId: string) => {
  const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return

  // Show exit overlay
  setClosingTabId(tabId)
  setExitSteps([...])

  // Run cleanup
  if (tab.isDevServerRunning) {
    await window.api.dev.stop(tab.project.path)
    markStepDone(0)
  }
  if (tab.ptyId) {
    window.api.pty.kill(tab.ptyId)
    markStepDone(1)
  }
  // ... etc

  // Remove tab
  useTabsStore.getState().closeTab(tabId)
  setClosingTabId(null)
}, [])
```

**Step 2: Commit**

```bash
git add src/renderer/components/TabBar/TabBar.tsx
git commit -m "feat: tab close with animated cleanup steps"
```

---

## Phase 7: Worktree Integration

### Task 14: Add Worktree IPC Handlers

**Files:**
- Create: `src/main/services/worktree.ts`
- Modify: `src/preload/index.ts` (add worktree namespace)
- Modify: `src/main/index.ts` (register handlers)

**Step 1: Implement worktree handlers**

```typescript
// src/main/services/worktree.ts
import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import * as fs from 'fs'
import * as path from 'path'

export function setupWorktreeHandlers(): void {
  // List worktrees for a project
  ipcMain.handle('worktree:list', async (_event, projectPath: string) => {
    const git = simpleGit(projectPath)
    // git worktree list --porcelain
    const raw = await git.raw(['worktree', 'list', '--porcelain'])
    return parseWorktreeList(raw)
  })

  // Create new worktree with new branch
  ipcMain.handle('worktree:create', async (_event, opts: {
    projectPath: string
    branchName: string
    targetDir: string
  }) => {
    const git = simpleGit(opts.projectPath)
    await git.raw(['worktree', 'add', opts.targetDir, '-b', opts.branchName])
    return { path: opts.targetDir, branch: opts.branchName }
  })

  // Create worktree for existing branch
  ipcMain.handle('worktree:checkout', async (_event, opts: {
    projectPath: string
    branchName: string
    targetDir: string
  }) => {
    const git = simpleGit(opts.projectPath)
    await git.raw(['worktree', 'add', opts.targetDir, opts.branchName])
    return { path: opts.targetDir, branch: opts.branchName }
  })

  // Remove worktree
  ipcMain.handle('worktree:remove', async (_event, opts: {
    projectPath: string
    worktreePath: string
  }) => {
    const git = simpleGit(opts.projectPath)
    await git.raw(['worktree', 'remove', opts.worktreePath])
    return { ok: true }
  })

  // List branches
  ipcMain.handle('worktree:branches', async (_event, projectPath: string) => {
    const git = simpleGit(projectPath)
    const summary = await git.branchLocal()
    return { current: summary.current, branches: summary.all }
  })
}

function parseWorktreeList(raw: string): Array<{ path: string; branch: string; head: string }> {
  const entries: Array<{ path: string; branch: string; head: string }> = []
  const blocks = raw.trim().split('\n\n')
  for (const block of blocks) {
    const lines = block.split('\n')
    const pathLine = lines.find((l) => l.startsWith('worktree '))
    const headLine = lines.find((l) => l.startsWith('HEAD '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    if (pathLine) {
      entries.push({
        path: pathLine.replace('worktree ', ''),
        head: headLine?.replace('HEAD ', '') || '',
        branch: branchLine?.replace('branch refs/heads/', '') || 'detached',
      })
    }
  }
  return entries
}
```

**Step 2: Add preload bridge**

```typescript
worktree: {
  list: (projectPath: string) => ipcRenderer.invoke('worktree:list', projectPath),
  create: (opts) => ipcRenderer.invoke('worktree:create', opts),
  checkout: (opts) => ipcRenderer.invoke('worktree:checkout', opts),
  remove: (opts) => ipcRenderer.invoke('worktree:remove', opts),
  branches: (projectPath: string) => ipcRenderer.invoke('worktree:branches', projectPath),
}
```

**Step 3: Register in main/index.ts**

```typescript
import { setupWorktreeHandlers } from './services/worktree'
// In createWindow():
setupWorktreeHandlers()
```

**Step 4: Commit**

```bash
git add src/main/services/worktree.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: add worktree IPC handlers for list/create/checkout/remove"
```

---

### Task 15: New Tab Menu with Worktree Options

**Files:**
- Create: `src/renderer/components/TabBar/NewTabMenu.tsx`
- Modify: `src/renderer/components/TabBar/TabBar.tsx` (show menu on + click)

**Step 1: Create NewTabMenu component**

Three options:
1. **New branch** — text input for branch name, creates worktree at `../<project>-<branch>/`, installs deps, opens tab
2. **Existing branch** — dropdown of branches, creates worktree, opens tab
3. **Different project** — goes to project picker

```typescript
// src/renderer/components/TabBar/NewTabMenu.tsx
import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { GitBranch, FolderPlus, Plus } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'

interface NewTabMenuProps {
  onClose: () => void
  anchorRect: DOMRect
}

export function NewTabMenu({ onClose, anchorRect }: NewTabMenuProps) {
  const activeTab = useTabsStore((s) => s.getActiveTab())
  const [mode, setMode] = useState<'menu' | 'new-branch' | 'existing-branch'>('menu')
  const [branchName, setBranchName] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const handleNewBranch = useCallback(async () => {
    if (!activeTab || !branchName.trim()) return
    setLoading(true)
    const targetDir = `${activeTab.project.path}/../${activeTab.project.name}-${branchName.trim()}`
    try {
      const result = await window.api.worktree.create({
        projectPath: activeTab.project.path,
        branchName: branchName.trim(),
        targetDir,
      })
      useTabsStore.getState().addTab({
        name: activeTab.project.name,
        path: result.path,
      })
      // TODO: install deps in worktree
      onClose()
    } catch (err: any) {
      // Show toast
    }
    setLoading(false)
  }, [activeTab, branchName, onClose])

  const loadBranches = useCallback(async () => {
    if (!activeTab) return
    setMode('existing-branch')
    const result = await window.api.worktree.branches(activeTab.project.path)
    setBranches(result.branches.filter((b: string) => b !== result.current))
  }, [activeTab])

  const handleDifferentProject = useCallback(() => {
    onClose()
    useProjectStore.getState().setScreen('project-picker')
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="absolute top-full left-0 mt-1 w-64 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[100] overflow-hidden"
      style={{ left: anchorRect.left }}
    >
      {mode === 'menu' && (
        <>
          <button onClick={() => setMode('new-branch')} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white/70 hover:bg-white/5">
            <Plus size={12} className="text-[var(--accent-cyan)]" />
            New branch (worktree)
          </button>
          <button onClick={loadBranches} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white/70 hover:bg-white/5">
            <GitBranch size={12} />
            Existing branch
          </button>
          <div className="border-t border-white/5" />
          <button onClick={handleDifferentProject} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white/70 hover:bg-white/5">
            <FolderPlus size={12} />
            Different project
          </button>
        </>
      )}
      {/* ... new-branch input, existing-branch list modes */}
    </motion.div>
  )
}
```

**Step 2: Wire into TabBar + click**

**Step 3: Commit**

```bash
git add src/renderer/components/TabBar/NewTabMenu.tsx src/renderer/components/TabBar/TabBar.tsx
git commit -m "feat: new tab menu with worktree, branch, and project options"
```

---

## Phase 8: Tab Persistence & Polish

### Task 16: Persist Tabs Across Restarts

**Files:**
- Modify: `src/renderer/stores/tabs.ts` (save/restore from settings)

**Step 1: Add persistence**

On tab change, save tab list to settings. On app start, restore tabs.

```typescript
// In TabsStore, after every mutation:
const persistTabs = () => {
  const { tabs } = useTabsStore.getState()
  const serialized = tabs.map((t) => ({
    project: t.project,
    worktreeBranch: t.worktreeBranch,
    worktreePath: t.worktreePath,
  }))
  window.api.settings.set('tabs', serialized)
}

// On app startup (in App.tsx):
window.api.settings.get('tabs').then((saved) => {
  if (Array.isArray(saved) && saved.length > 0) {
    for (const t of saved) {
      useTabsStore.getState().addTab(t.project)
    }
    useProjectStore.getState().setScreen('workspace')
  }
})
```

**Step 2: Commit**

```bash
git add src/renderer/stores/tabs.ts src/renderer/App.tsx
git commit -m "feat: persist tabs across app restarts"
```

---

### Task 17: Keyboard Shortcuts for Tab Navigation

**Files:**
- Modify: `src/renderer/hooks/useKeyboardShortcuts.ts`

**Step 1: Add tab shortcuts**

```typescript
// Cmd+1-9: Switch to tab by index
// Cmd+W: Close active tab
// Cmd+T: New tab menu
// Cmd+Shift+]: Next tab
// Cmd+Shift+[: Previous tab
```

**Step 2: Commit**

```bash
git add src/renderer/hooks/useKeyboardShortcuts.ts
git commit -m "feat: keyboard shortcuts for tab navigation (Cmd+1-9, Cmd+W, Cmd+T)"
```

---

### Task 18: Tab Drag Reorder

**Files:**
- Modify: `src/renderer/components/TabBar/TabBar.tsx` (drag handlers)

**Step 1: Add drag reorder using Framer Motion's Reorder**

```typescript
import { Reorder } from 'framer-motion'

<Reorder.Group axis="x" values={tabs} onReorder={reorderTabs}>
  {tabs.map((tab) => (
    <Reorder.Item key={tab.id} value={tab}>
      <Tab ... />
    </Reorder.Item>
  ))}
</Reorder.Group>
```

**Step 2: Add `reorderTabs` to TabsStore**

```typescript
reorderTabs: (newOrder: TabState[]) => set({ tabs: newOrder })
```

**Step 3: Commit**

```bash
git add src/renderer/components/TabBar/TabBar.tsx src/renderer/stores/tabs.ts
git commit -m "feat: drag-to-reorder tabs"
```

---

## Verification Checklist

After all tasks complete, verify:

1. **Single tab works**: Open project → tab appears → terminal + canvas work → close tab → project picker
2. **Multiple tabs**: Open two different projects → both have separate terminals, dev servers, canvas states
3. **Tab switching**: Click between tabs → terminal content preserved, dev server states independent
4. **Worktree flow**: Click + → New branch → creates worktree → new tab with its own terminal
5. **MCP routing**: Claude Code in tab A sends canvas_render → only tab A's canvas updates
6. **Tab close**: Close tab → dev server stops, PTY killed, cleanup animation shows
7. **Persistence**: Close app → reopen → tabs restored with correct projects
8. **Keyboard**: Cmd+1/2/3 switches tabs, Cmd+W closes, Cmd+T opens new tab menu
9. **Build**: `npx electron-vite build` compiles cleanly
10. **Tests**: `npm test` passes all tests including new TabsStore tests
