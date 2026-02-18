# Boot Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the janky terminal loading sequence with a cinematic "Mission Control" overlay that shows real boot progress and reveals the terminal once Claude is ready.

**Architecture:** A `<BootOverlay>` component renders as an absolute-positioned overlay on top of the Workspace. The terminal mounts and boots behind it. Three boolean flags (`boot.ptyReady`, `boot.mcpReady`, `boot.claudeReady`) are added to `TabState` and set by existing code paths. The overlay subscribes to these flags and performs a Framer Motion exit animation when all are true.

**Tech Stack:** React 19, Zustand, Framer Motion, Tailwind 4, Lucide icons

---

### Task 1: Add `boot` field to TabState

**Files:**
- Modify: `src/renderer/stores/tabs.ts:27-77` (TabState interface)
- Modify: `src/renderer/stores/tabs.ts:79-118` (createDefaultTabState)
- Test: `src/renderer/__tests__/tabs-store.test.ts`

**Step 1: Write the failing test**

Add to `src/renderer/__tests__/tabs-store.test.ts`:

```ts
it('new tabs have boot state defaulting to all false', () => {
  const { addTab } = useTabsStore.getState()
  addTab({ name: 'BootTest', path: '/boot-test' })
  const tab = useTabsStore.getState().tabs[0]
  expect(tab.boot).toEqual({ ptyReady: false, mcpReady: false, claudeReady: false })
})

it('updateTab can set boot flags independently', () => {
  const { addTab, updateTab } = useTabsStore.getState()
  addTab({ name: 'BootTest', path: '/boot-test' })
  const tab = useTabsStore.getState().tabs[0]
  updateTab(tab.id, { boot: { ...tab.boot, ptyReady: true } })
  const updated = useTabsStore.getState().tabs[0]
  expect(updated.boot.ptyReady).toBe(true)
  expect(updated.boot.mcpReady).toBe(false)
  expect(updated.boot.claudeReady).toBe(false)
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/renderer/__tests__/tabs-store.test.ts`
Expected: FAIL — `tab.boot` is undefined

**Step 3: Write minimal implementation**

In `src/renderer/stores/tabs.ts`, add to the `TabState` interface after line 76 (after `supabaseBootstrapped`):

```ts
// Boot progress (overlay tracks these to show loading state)
boot: {
  ptyReady: boolean
  mcpReady: boolean
  claudeReady: boolean
}
```

In `createDefaultTabState`, add after `supabaseBootstrapped: false` (line 116):

```ts
boot: { ptyReady: false, mcpReady: false, claudeReady: false },
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/renderer/__tests__/tabs-store.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/renderer/stores/tabs.ts src/renderer/__tests__/tabs-store.test.ts
git commit -m "feat: add boot progress flags to TabState"
```

---

### Task 2: Set boot flags from existing code paths

**Files:**
- Modify: `src/renderer/hooks/usePty.ts:81-175` (connect function)
- Modify: `src/renderer/App.tsx:98-111` (MCP ready handler)

**Step 1: Set `boot.ptyReady` after PTY spawn**

In `src/renderer/hooks/usePty.ts`, inside `connect()`, after line 107 where `updateTab` is called with `ptyId`:

```ts
useTabsStore.getState().updateTab(targetTabId, { ptyId: id })
```

Add immediately after:

```ts
// Mark PTY as ready for boot overlay
const currentTab = useTabsStore.getState().tabs.find(t => t.id === targetTabId)
if (currentTab) {
  useTabsStore.getState().updateTab(targetTabId, {
    boot: { ...currentTab.boot, ptyReady: true }
  })
}
```

**Step 2: Detect Claude CLI output for `boot.claudeReady`**

In `src/renderer/hooks/usePty.ts`, inside the `onData` handler (around line 137), add Claude detection. Right after `terminal.write(data)` (line 139), add:

```ts
// Detect Claude CLI startup for boot overlay
if (!claudeLaunchedRef.current) return // only track during boot
if (typeof data === 'string' && /claude/i.test(data) && targetTabId) {
  const t = useTabsStore.getState().tabs.find(tab => tab.id === targetTabId)
  if (t && !t.boot.claudeReady) {
    useTabsStore.getState().updateTab(targetTabId, {
      boot: { ...t.boot, claudeReady: true }
    })
  }
}
```

Wait — that won't work because `claudeLaunchedRef` is true once Claude is launched, and we want to detect Claude's *output* after launch. Better approach: detect after `launchClaude()` fires, and look for Claude CLI's first real output. Simpler: just set `claudeReady` when `launchClaude()` runs + a small delay for Claude to print its banner.

Revised approach — in `launchClaude()` function body (after line 130 `window.api.pty.write(id, 'clear; claude\r')`), add:

```ts
// Mark Claude as launched for boot overlay — add slight delay for CLI to render
setTimeout(() => {
  if (!targetTabId) return
  const t = useTabsStore.getState().tabs.find(tab => tab.id === targetTabId)
  if (t) {
    useTabsStore.getState().updateTab(targetTabId, {
      boot: { ...t.boot, claudeReady: true }
    })
  }
}, 1500)
```

Note: `targetTabId` is already in closure scope from `connect()`.

**Step 3: Set `boot.mcpReady` in App.tsx MCP handler**

In `src/renderer/App.tsx`, in the MCP ready handler (around line 106-109), after `useProjectStore.getState().setMcpReady(true, port)`:

```ts
// Mark MCP ready for boot overlay
const activeTab = useTabsStore.getState().getActiveTab()
if (activeTab) {
  useTabsStore.getState().updateTab(activeTab.id, { mcpReady: true, mcpPort: port })
  useTabsStore.getState().updateTab(activeTab.id, {
    boot: { ...activeTab.boot, mcpReady: true }
  })
}
```

Note: the existing code already does `updateTab(activeTab.id, { mcpReady: true, mcpPort: port })` on line 109. Merge the boot flag into that same call to avoid a redundant update. Replace lines 107-109:

```ts
const activeTab = useTabsStore.getState().getActiveTab()
if (activeTab) {
  useTabsStore.getState().updateTab(activeTab.id, {
    mcpReady: true,
    mcpPort: port,
    boot: { ...activeTab.boot, mcpReady: true }
  })
}
```

**Step 4: Run tests to verify nothing broke**

Run: `npm test -- --run`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/renderer/hooks/usePty.ts src/renderer/App.tsx
git commit -m "feat: set boot progress flags from PTY, MCP, and Claude launch"
```

---

### Task 3: Create the BootOverlay component

**Files:**
- Create: `src/renderer/components/BootOverlay/BootOverlay.tsx`

**Step 1: Create the component file**

Create `src/renderer/components/BootOverlay/BootOverlay.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTabsStore } from '@/stores/tabs'
import { Terminal, Radio, Sparkles, Check, Loader2 } from 'lucide-react'

const FEATURES = ['Canvas', 'Gallery', 'Timeline', 'Inspector', 'Preview']

interface BootStep {
  key: string
  label: string
  icon: React.ReactNode
  done: boolean
}

interface BootOverlayProps {
  tabId: string
  projectName: string
}

export function BootOverlay({ tabId, projectName }: BootOverlayProps) {
  const boot = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    return tab?.boot ?? { ptyReady: false, mcpReady: false, claudeReady: false }
  })

  const [dismissed, setDismissed] = useState(false)
  const [showReady, setShowReady] = useState(false)

  const allDone = boot.ptyReady && boot.mcpReady && boot.claudeReady

  // When all steps complete, show "Ready" briefly then dismiss
  useEffect(() => {
    if (!allDone) return
    const readyTimer = setTimeout(() => setShowReady(true), 200)
    const dismissTimer = setTimeout(() => setDismissed(true), 800)
    return () => {
      clearTimeout(readyTimer)
      clearTimeout(dismissTimer)
    }
  }, [allDone])

  const steps: BootStep[] = useMemo(() => [
    {
      key: 'pty',
      label: 'Terminal',
      icon: <Terminal size={14} />,
      done: boot.ptyReady,
    },
    {
      key: 'mcp',
      label: 'MCP bridge',
      icon: <Radio size={14} />,
      done: boot.mcpReady,
    },
    {
      key: 'claude',
      label: 'Claude Code',
      icon: <Sparkles size={14} />,
      done: boot.claudeReady,
    },
  ], [boot.ptyReady, boot.mcpReady, boot.claudeReady])

  // Calculate progress percentage
  const doneCount = steps.filter((s) => s.done).length
  const progress = showReady ? 100 : (doneCount / (steps.length + 1)) * 100

  if (dismissed) return null

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          key="boot-overlay"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-primary)' }}
        >
          <div className="flex flex-col items-center gap-8 w-[320px]">
            {/* Logo */}
            <div className="text-center">
              <h1 className="text-xl font-bold bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-coral)] bg-clip-text text-transparent">
                Claude Canvas
              </h1>
              <p className="text-white/40 text-sm mt-1 font-mono">{projectName}</p>
            </div>

            {/* Steps */}
            <div className="w-full space-y-3">
              {steps.map((step, i) => {
                // Active = first undone step
                const isActive = !step.done && steps.slice(0, i).every((s) => s.done)
                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1, duration: 0.3 }}
                    className="flex items-center justify-between px-4 py-2 rounded-lg"
                    style={{
                      backgroundColor: step.done
                        ? 'rgba(74, 234, 255, 0.05)'
                        : isActive
                          ? 'rgba(255, 255, 255, 0.03)'
                          : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={
                          step.done
                            ? 'text-[var(--accent-cyan)]'
                            : isActive
                              ? 'text-white/60'
                              : 'text-white/20'
                        }
                      >
                        {step.icon}
                      </div>
                      <span
                        className={`text-sm font-mono ${
                          step.done
                            ? 'text-white/70'
                            : isActive
                              ? 'text-white/50'
                              : 'text-white/20'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    <div className="flex items-center">
                      {step.done ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                        >
                          <Check size={14} className="text-[var(--accent-cyan)]" />
                        </motion.div>
                      ) : isActive ? (
                        <Loader2 size={14} className="text-white/40 animate-spin" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-white/10" />
                      )}
                    </div>
                  </motion.div>
                )
              })}

              {/* Ready row */}
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: showReady ? 1 : 0.3, x: 0 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                className="flex items-center justify-between px-4 py-2 rounded-lg"
                style={{
                  backgroundColor: showReady ? 'rgba(74, 234, 255, 0.08)' : 'transparent',
                }}
              >
                <div className="flex items-center gap-3">
                  <Sparkles
                    size={14}
                    className={showReady ? 'text-[var(--accent-cyan)]' : 'text-white/20'}
                  />
                  <span
                    className={`text-sm font-mono ${
                      showReady ? 'text-[var(--accent-cyan)] font-medium' : 'text-white/20'
                    }`}
                  >
                    Ready
                  </span>
                </div>
                {showReady && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <Check size={14} className="text-[var(--accent-cyan)]" />
                  </motion.div>
                )}
              </motion.div>
            </div>

            {/* Progress bar */}
            <div className="w-full px-4">
              <div className="h-[3px] w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-coral))',
                  }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Feature tags */}
            <div className="flex items-center gap-3 flex-wrap justify-center">
              {FEATURES.map((feature, i) => (
                <motion.span
                  key={feature}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
                  className="text-[11px] font-mono text-white/15 tracking-wide"
                >
                  {feature}
                </motion.span>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

**Step 2: Verify it compiles**

Run: `npm run build 2>&1 | head -20`
Expected: No TypeScript errors related to BootOverlay

**Step 3: Commit**

```bash
git add src/renderer/components/BootOverlay/BootOverlay.tsx
git commit -m "feat: add BootOverlay component with step progress and cinematic reveal"
```

---

### Task 4: Mount BootOverlay in Workspace

**Files:**
- Modify: `src/renderer/components/Workspace/Workspace.tsx:1-10` (imports)
- Modify: `src/renderer/components/Workspace/Workspace.tsx:163-202` (tab render loop)

**Step 1: Add the overlay to the Workspace**

In `src/renderer/components/Workspace/Workspace.tsx`, add import at the top:

```ts
import { BootOverlay } from '../BootOverlay/BootOverlay'
```

In the tab render loop (around line 163), inside the `<div key={tab.id}>` wrapper but after the `<TerminalView>`, add the overlay as a sibling. The overlay needs the tab's `id` and `projectName`. Update the map body to extract project name from the store.

Find the block starting at line 167:

```tsx
return (
  <div
    key={tab.id}
    className={...}
    style={...}
  >
```

After the TerminalView closing `</div>` (line 199) and before the parent div close, add:

```tsx
{/* Boot overlay — covers terminal until Claude is ready */}
{!splitViewActive && isActive && (
  <BootOverlay
    tabId={tab.id}
    projectName={tab.projectPath.split('/').pop() || 'project'}
  />
)}
```

Wait — `tab` in this context is `{ id, projectPath }` from `useTabList()`. That's fine, we can derive the name from the path.

Actually, the overlay needs to render inside the same container as the terminal so it covers it. The structure is:

```tsx
<div key={tab.id} className={...} style={...}>
  {/* SplitPaneHeader (hidden when not split) */}
  <div style={...}>...</div>

  {/* TerminalView */}
  <div className={...}>
    <TerminalView ... />
  </div>

  {/* BootOverlay — positioned absolute, covers terminal */}
  {!splitViewActive && isActive && (
    <BootOverlay
      tabId={tab.id}
      projectName={tab.projectPath.split('/').pop() || 'project'}
    />
  )}
</div>
```

The parent div already has `relative` positioning (via `absolute inset-0` for non-split mode), so the overlay's `absolute inset-0 z-20` will cover the terminal correctly.

**Step 2: Verify it compiles and renders**

Run: `npm run build 2>&1 | head -20`
Expected: Clean build

**Step 3: Commit**

```bash
git add src/renderer/components/Workspace/Workspace.tsx
git commit -m "feat: mount BootOverlay in Workspace over terminal pane"
```

---

### Task 5: Remove the old welcome banner and simplify usePty

**Files:**
- Modify: `src/renderer/hooks/usePty.ts:16-50` (writeWelcomeBanner)
- Modify: `src/renderer/hooks/usePty.ts:81-170` (connect function)

**Step 1: Remove `writeWelcomeBanner` function**

Delete the entire `writeWelcomeBanner` function (lines 16-50 in `usePty.ts`).

**Step 2: Simplify `connect()` — remove double banner draw**

In the `connect()` function:

1. Remove the early `writeWelcomeBanner(terminal)` call (was at line 90 after the `if (options?.autoLaunchClaude)` check)
2. In `launchClaude()`, remove `terminal.reset()` and the second `writeWelcomeBanner(terminal)` call. The function body becomes just:

```ts
const launchClaude = async () => {
  if (ptyIdRef.current !== id || claudeLaunchedRef.current) return
  claudeLaunchedRef.current = true
  suppressOutput = false
  terminal.reset()
  window.api.pty.write(id, 'claude\r')
}
```

Note: keep `terminal.reset()` to clear shell init noise, but remove the banner redraw. Keep `suppressOutput = false` so the Claude CLI output appears. Remove the `clear;` from the write command since `terminal.reset()` already clears.

3. Keep the `suppressOutput` flag — it still serves a purpose hiding shell init noise (compdef errors etc.) while the overlay is showing. The overlay hides the terminal visually, but the terminal still processes output. We want to avoid the user seeing a flash of shell noise if the overlay dismiss timing is slightly off.

**Step 3: Run tests to verify nothing broke**

Run: `npm test -- --run`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/renderer/hooks/usePty.ts
git commit -m "refactor: remove welcome banner, simplify PTY boot sequence"
```

---

### Task 6: Manual QA and polish

**Step 1: Run the app**

Run: `npm run dev`

**Step 2: Verify the boot sequence**

1. Select a project from the project picker
2. Verify the overlay appears immediately (no blank terminal flash)
3. Verify steps check off as they complete:
   - "Terminal" → checkmark after PTY spawns (~200ms)
   - "MCP bridge" → checkmark after MCP ready (~500ms-2s)
   - "Claude Code" → checkmark after Claude launched (~2-4s)
   - "Ready" → checkmark + progress hits 100%
4. Verify the overlay fades out smoothly (0.5s, slides up 20px)
5. Verify the terminal underneath has Claude running and ready for input
6. Verify feature tags animate in staggered at the bottom

**Step 3: Edge cases to test**

- Open a second project tab → should get its own overlay
- Close a tab during boot → no crash
- Slow MCP startup (network lag) → overlay stays until all flags set

**Step 4: Commit any polish fixes**

```bash
git add -A
git commit -m "fix: boot overlay polish from QA"
```

---

### Task 7: Final commit — squash debug logs

**Step 1: Remove any leftover `[TAB-DEBUG]` console.logs added during development**

Search for any new debug logs added in this feature branch and remove them.

**Step 2: Final test run**

Run: `npm test -- --run`
Expected: All PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up debug logs from boot overlay feature"
```
