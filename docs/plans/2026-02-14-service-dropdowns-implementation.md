# Service Dropdowns Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the GitHub and Vercel dropdowns in `ServiceIcons.tsx` from connection-management panels into "Command Center" mini-dashboards with contextual primary actions, quick actions, deployment status at a glance, and keyboard shortcuts.

**Architecture:** The existing `ServiceIcons` component is a single 1235-line file handling all three services. We'll add two new IPC handlers in the main process (`github:prStatus`, `vercel:redeploy`), extend the tab store with timestamp fields, then rebuild the dropdown UI section-by-section. Build logs will move from inline-in-dropdown to the canvas panel.

**Tech Stack:** Electron IPC (ipcMain.handle), Zustand stores, React 19, Framer Motion, Lucide icons, Tailwind 4

**Design Doc:** `docs/plans/2026-02-14-service-dropdowns-redesign.md`

---

### Task 1: Add `github:prStatus` IPC handler

**Files:**
- Modify: `src/main/oauth/github.ts` (add new handler inside `setupGithubOAuth`)
- Modify: `src/preload/index.ts` (expose new method)

**Step 1: Write the IPC handler**

Add this handler inside `setupGithubOAuth()` in `src/main/oauth/github.ts`, after the existing `oauth:github:createRepo` handler:

```typescript
ipcMain.handle('oauth:github:prStatus', async (_event, repoFullName: string, branch: string) => {
  const token = settingsStore.get('oauthTokens.github') as string | undefined
  if (!token) return { error: 'Not connected' }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/pulls?head=${repoFullName.split('/')[0]}:${branch}&state=open`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    )
    if (!res.ok) return { error: `GitHub API: ${res.status}` }
    const prs = await res.json()
    if (prs.length > 0) {
      return { hasPR: true, number: prs[0].number, url: prs[0].html_url, title: prs[0].title }
    }
    return { hasPR: false }
  } catch (err: any) {
    return { error: err?.message || 'Failed to check PR status' }
  }
})
```

**Step 2: Expose in preload bridge**

In `src/preload/index.ts`, add inside the `oauth.github` object:

```typescript
prStatus: (repoFullName: string, branch: string) =>
  ipcRenderer.invoke('oauth:github:prStatus', repoFullName, branch) as Promise<
    { hasPR: true; number: number; url: string; title: string } |
    { hasPR: false } |
    { error: string }
  >,
```

**Step 3: Verify manually**

Run: `npm run dev`
Open the app, connect GitHub, open DevTools console:
```js
await window.api.oauth.github.prStatus('owner/repo', 'main')
```
Expected: Returns `{ hasPR: false }` or `{ hasPR: true, number: N, url: '...', title: '...' }`

**Step 4: Commit**

```bash
git add src/main/oauth/github.ts src/preload/index.ts
git commit -m "feat: add github:prStatus IPC handler for PR detection"
```

---

### Task 2: Add `vercel:redeploy` IPC handler

**Files:**
- Modify: `src/main/oauth/vercel.ts` (add new handler inside `setupVercelOAuth`)
- Modify: `src/preload/index.ts` (expose new method)

**Step 1: Write the IPC handler**

Add inside `setupVercelOAuth()` in `src/main/oauth/vercel.ts`, after the existing `oauth:vercel:importProject` handler:

```typescript
ipcMain.handle('oauth:vercel:redeploy', async (_event, deploymentId: string) => {
  const token = settingsStore.get('oauthTokens.vercel') as string | undefined
  if (!token) return { error: 'Not connected' }
  try {
    const teamId = settingsStore.get('vercelAuth.teamId') as string | undefined
    const url = `https://api.vercel.com/v13/deployments?${teamId ? `teamId=${teamId}&` : ''}forceNew=1`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deploymentId,
        name: undefined, // inherits from original
        target: 'production'
      })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: body?.error?.message || `Vercel API: ${res.status}` }
    }
    const data = await res.json()
    return { id: data.id, url: `https://${data.url}`, state: data.readyState || 'BUILDING' }
  } catch (err: any) {
    return { error: err?.message || 'Redeploy failed' }
  }
})
```

**Step 2: Expose in preload bridge**

In `src/preload/index.ts`, add inside the `oauth.vercel` object:

```typescript
redeploy: (deploymentId: string) =>
  ipcRenderer.invoke('oauth:vercel:redeploy', deploymentId) as Promise<
    { id: string; url: string; state: string } | { error: string }
  >,
```

**Step 3: Verify manually**

Run: `npm run dev`
Open DevTools console (with Vercel connected and a project linked):
```js
const linked = await window.api.oauth.vercel.linkedProject({ projectPath: '/path/to/project' })
// use the latestDeployment.id if available
```
Expected: Returns `{ id, url, state: 'BUILDING' }` or `{ error: '...' }`

**Step 4: Commit**

```bash
git add src/main/oauth/vercel.ts src/preload/index.ts
git commit -m "feat: add vercel:redeploy IPC handler"
```

---

### Task 3: Extend tab store with timestamp fields

**Files:**
- Modify: `src/renderer/stores/tabs.ts` (add fields)
- Modify: `src/renderer/__tests__/stores.test.ts` (add tests)

**Step 1: Write the failing test**

In `src/renderer/__tests__/stores.test.ts`, add a new test:

```typescript
describe('Tab store timestamp fields', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('tracks lastPushTime and lastFetchTime on tabs', () => {
    const id = useTabsStore.getState().addTab({ name: 'test', path: '/tmp/test' })
    const tab = useTabsStore.getState().tabs.find(t => t.id === id)
    expect(tab?.lastPushTime).toBe(null)
    expect(tab?.lastFetchTime).toBe(null)

    const now = Date.now()
    useTabsStore.getState().updateTab(id, { lastPushTime: now })
    const updated = useTabsStore.getState().tabs.find(t => t.id === id)
    expect(updated?.lastPushTime).toBe(now)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/renderer/__tests__/stores.test.ts`
Expected: FAIL — `lastPushTime` property does not exist

**Step 3: Add fields to tab store**

In `src/renderer/stores/tabs.ts`, add to the tab state interface (near `gitAhead`, `gitBehind`, `gitSyncing`, `gitRemoteConfigured`):

```typescript
lastPushTime: number | null
lastFetchTime: number | null
```

In `createDefaultTabState()`, add defaults:

```typescript
lastPushTime: null,
lastFetchTime: null,
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/renderer/__tests__/stores.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/stores/tabs.ts src/renderer/__tests__/stores.test.ts
git commit -m "feat: add lastPushTime and lastFetchTime to tab store"
```

---

### Task 4: Update StatusBar to track push/fetch timestamps

**Files:**
- Modify: `src/renderer/components/StatusBar/PushPopover.tsx` (record lastPushTime on successful push)
- Modify: `src/renderer/components/StatusBar/StatusBar.tsx` (record lastFetchTime on successful pull/fetch)

**Step 1: Update PushPopover push handler**

In `src/renderer/components/StatusBar/PushPopover.tsx`, inside the `handlePush` callback, after the line that updates `gitAhead`/`gitBehind` on success (the `useTabsStore.getState().updateTab(tab.id, {...})` call), add `lastPushTime: Date.now()` to the update object:

```typescript
useTabsStore.getState().updateTab(tab.id, {
  gitAhead: counts.ahead || 0,
  gitBehind: counts.behind || 0,
  gitSyncing: false,
  lastPushTime: Date.now(),
})
```

**Step 2: Update StatusBar pull handler**

In `src/renderer/components/StatusBar/StatusBar.tsx`, inside `handlePull`, after the `updateTab` call that refreshes counts, add `lastFetchTime: Date.now()`:

```typescript
useTabsStore.getState().updateTab(activeTab.id, {
  gitAhead: counts.ahead || 0,
  gitBehind: counts.behind || 0,
  lastFetchTime: Date.now(),
})
```

**Step 3: Verify manually**

Run: `npm run dev`
Push some commits, then check DevTools:
```js
// Check that timestamps are recorded
```

**Step 4: Commit**

```bash
git add src/renderer/components/StatusBar/PushPopover.tsx src/renderer/components/StatusBar/StatusBar.tsx
git commit -m "feat: record push/fetch timestamps in tab store"
```

---

### Task 5: Rebuild GitHub dropdown — disconnected state

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

This task and the following tasks rebuild the dropdown section-by-section. We start with the simplest state: disconnected.

**Step 1: Replace the GitHub disconnected UI**

In `ServiceIcons.tsx`, find the GitHub dropdown's connect/disconnect section (the bottom of the GitHub dropdown, around lines 855-869). Replace the disconnected state block with:

```tsx
{/* Connect / Disconnect */}
{status.github ? (
  <button
    onClick={() => disconnectService('github')}
    className="w-full px-3 py-2 text-xs text-left text-white/30 hover:bg-white/5 hover:text-white/50 transition"
  >
    Disconnect
  </button>
) : (
  <div className="p-4 text-center">
    <Github size={24} className="mx-auto mb-2.5 text-white/20" />
    <p className="text-xs text-white/40 mb-3 leading-relaxed">
      Push code, create PRs, and<br />collaborate with your team.
    </p>
    <button
      onClick={() => connectService('github')}
      className="w-full py-2 text-xs font-medium text-white bg-[#238636] hover:bg-[#2ea043] rounded-lg transition-colors"
    >
      Connect to GitHub
    </button>
  </div>
)}
```

Also update the dropdown's header for the disconnected case. Find the section that shows just "GitHub" text when not connected (around line 743-746) and remove the repo info section that shows when disconnected (the `{status.github && (...)}` block should only render when connected).

**Step 2: Verify visually**

Run: `npm run dev`
Disconnect GitHub, click the GitHub icon. Should see the centered CTA with value prop text.

**Step 3: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat: redesign GitHub dropdown disconnected state"
```

---

### Task 6: Rebuild GitHub dropdown — contextual primary action

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 1: Add state for PR info and branch data**

Add new state variables near the existing GitHub state in `ServiceIcons`:

```typescript
const [prInfo, setPrInfo] = useState<{ number: number; url: string; title: string } | null>(null)
const [loadingPr, setLoadingPr] = useState(false)
const [localBranches, setLocalBranches] = useState<string[]>([])
const [currentBranch, setCurrentBranch] = useState<string | null>(null)
```

**Step 2: Read git sync state from tab store**

Add these reads from the active tab (import `useTabsStore` if not already imported):

```typescript
const activeTab = useTabsStore((s) => {
  const id = s.activeTabId
  return id ? s.tabs.find((t) => t.id === id) ?? null : null
})
const gitAhead = activeTab?.gitAhead ?? 0
const gitBehind = activeTab?.gitBehind ?? 0
const gitRemoteConfigured = activeTab?.gitRemoteConfigured ?? false
const lastPushTime = activeTab?.lastPushTime ?? null
const lastFetchTime = activeTab?.lastFetchTime ?? null
```

**Step 3: Add PR check and branch fetch when dropdown opens**

Add an effect that fires when the GitHub dropdown opens:

```typescript
useEffect(() => {
  if (dropdownOpen !== 'github' || !status.github) return

  // Fetch branches
  if (currentProject?.path) {
    window.api.worktree.branches(currentProject.path).then((result) => {
      setCurrentBranch(result.current)
      setLocalBranches(result.branches.filter((b: string) => b !== result.current))
    }).catch(() => {})
  }

  // Check PR status
  if (repoName && currentProject?.path) {
    window.api.git.getProjectInfo(currentProject.path).then(({ branch }) => {
      if (!branch || branch === 'main' || branch === 'master') {
        setPrInfo(null)
        return
      }
      setLoadingPr(true)
      window.api.oauth.github.prStatus(repoName, branch).then((result) => {
        if ('hasPR' in result && result.hasPR) {
          setPrInfo({ number: result.number, url: result.url, title: result.title })
        } else {
          setPrInfo(null)
        }
        setLoadingPr(false)
      })
    })
  }
}, [dropdownOpen, status.github, repoName, currentProject?.path])
```

**Step 4: Build the contextual primary action button**

Replace the repo info section inside the GitHub dropdown (the `{status.github && (...)}` block, around lines 749-852) with the new layout. Insert the contextual primary action after the header:

```tsx
{status.github && (
  <>
    {/* Contextual primary action */}
    {repoName && (
      <div className="px-3 py-2.5 border-b border-white/10">
        {!gitRemoteConfigured ? (
          <button
            onClick={() => {
              setShowRepoInput(false)
              setShowLinkRepo(false)
              // Show repo setup
            }}
            className="w-full flex flex-col items-center gap-1 py-2.5 bg-[var(--accent-cyan)]/10 hover:bg-[var(--accent-cyan)]/15 border border-[var(--accent-cyan)]/20 rounded-lg transition-colors"
          >
            <span className="text-xs font-medium text-[var(--accent-cyan)]">Publish branch</span>
            <span className="text-[10px] text-white/30">Set up a remote to push</span>
          </button>
        ) : gitAhead > 0 ? (
          <button
            onClick={() => {
              setDropdownOpen(null)
              // Trigger push flow — find and click the push button in StatusBar
              document.querySelector<HTMLButtonElement>('[data-push-button]')?.click()
            }}
            className="w-full flex flex-col items-center gap-1 py-2.5 bg-[var(--accent-cyan)]/10 hover:bg-[var(--accent-cyan)]/15 border border-[var(--accent-cyan)]/20 rounded-lg transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-cyan)]">
              <ArrowUp size={12} />
              Push {gitAhead} commit{gitAhead !== 1 ? 's' : ''}
            </span>
            {lastPushTime && (
              <span className="text-[10px] text-white/25">Last pushed {timeAgo(lastPushTime)}</span>
            )}
          </button>
        ) : gitBehind > 0 ? (
          <button
            onClick={() => {
              setDropdownOpen(null)
              document.querySelector<HTMLButtonElement>('[data-pull-button]')?.click()
            }}
            className="w-full flex flex-col items-center gap-1 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/20 rounded-lg transition-colors"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-400">
              <ArrowDown size={12} />
              Pull {gitBehind} commit{gitBehind !== 1 ? 's' : ''}
            </span>
            {lastFetchTime && (
              <span className="text-[10px] text-white/25">Last fetched {timeAgo(lastFetchTime)}</span>
            )}
          </button>
        ) : (
          <div className="w-full flex flex-col items-center gap-1 py-2.5 bg-white/[0.03] border border-white/5 rounded-lg">
            <span className="flex items-center gap-1.5 text-xs text-white/30">
              <Check size={12} />
              Up to date
            </span>
            {lastPushTime && (
              <span className="text-[10px] text-white/20">Last pushed {timeAgo(lastPushTime)}</span>
            )}
          </div>
        )}
      </div>
    )}

    {/* Repo info or setup */}
    {repoName ? (
      <div className="px-3 py-2 border-b border-white/10">
        <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Repository</div>
        <div className="text-xs text-white/60 truncate">{repoName}</div>
      </div>
    ) : (
      /* Keep existing Link/Create repo UI here — the showLinkRepo and showRepoInput blocks */
      <div className="border-b border-white/10">
        {showLinkRepo ? (
          /* ... existing link repo search UI ... */
          <></>
        ) : showRepoInput ? (
          /* ... existing create repo input UI ... */
          <></>
        ) : (
          <>
            <button
              onClick={openLinkRepo}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
            >
              <GitBranch size={11} className="shrink-0" />
              Link Existing Repo
            </button>
            <button
              onClick={() => {
                const project = useProjectStore.getState().currentProject
                setNewRepoName(project?.path?.split('/').pop() || '')
                setShowRepoInput(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/5 transition"
            >
              <Plus size={11} className="shrink-0" />
              Create New Repo
            </button>
          </>
        )}
      </div>
    )}
  </>
)}
```

Import `ArrowUp`, `ArrowDown` from lucide-react if not already imported. Also import `useTabsStore` from `@/stores/tabs`.

**Step 5: Add `data-push-button` and `data-pull-button` attributes to StatusBar**

In `src/renderer/components/StatusBar/StatusBar.tsx`, add `data-push-button` to the push button and `data-pull-button` to the pull button so the dropdown can trigger them:

On the push button: add `data-push-button`
On the pull button: add `data-pull-button`

**Step 6: Verify visually**

Run: `npm run dev`
- With commits ahead: should see "Push N commits" button
- Up to date: should see "Up to date" with timestamp
- With commits behind: should see "Pull N commits"

**Step 7: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx src/renderer/components/StatusBar/StatusBar.tsx
git commit -m "feat: add contextual primary action to GitHub dropdown"
```

---

### Task 7: Add GitHub dropdown quick actions section

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 1: Add quick actions between the primary action and repo info**

Insert after the contextual primary action section, before the repo info section:

```tsx
{/* Quick actions */}
{repoName && (
  <div className="border-b border-white/10">
    {/* PR action — contextual */}
    {prInfo ? (
      <button
        onClick={() => window.open(prInfo.url, '_blank')}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
      >
        <GitPullRequest size={11} className="shrink-0 text-green-400" />
        <span className="truncate flex-1">PR #{prInfo.number}</span>
        <ExternalLink size={9} className="shrink-0 text-white/20" />
      </button>
    ) : gitAhead > 0 && currentBranch && currentBranch !== 'main' && currentBranch !== 'master' ? (
      <button
        onClick={async () => {
          if (!currentProject?.path) return
          setDropdownOpen(null)
          const { addToast } = useToastStore.getState()
          const msg = await window.api.git.generateCommitMessage(currentProject.path).catch(() => '')
          const result = await window.api.git.createPr(currentProject.path, {
            title: msg || `${currentBranch}`,
            body: '',
            base: 'main'
          })
          if ('url' in result) {
            addToast(`PR #${result.number} created`, 'success', {
              action: { label: 'Open', onClick: () => window.open(result.url, '_blank') }
            })
          } else {
            addToast(`PR failed: ${result.error}`, 'error')
          }
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/5 transition"
      >
        <Plus size={11} className="shrink-0" />
        Create Pull Request
      </button>
    ) : null}

    {/* Open on GitHub */}
    <button
      onClick={() => window.open(`https://github.com/${repoName}`, '_blank')}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
    >
      <ExternalLink size={11} className="shrink-0" />
      <span className="flex-1">Open on GitHub</span>
      <kbd className="text-[9px] text-white/15 font-mono">⌘⇧G</kbd>
    </button>

    {/* View Issues */}
    <button
      onClick={() => window.open(`https://github.com/${repoName}/issues`, '_blank')}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
    >
      <Circle size={11} className="shrink-0" />
      View Issues
    </button>
  </div>
)}
```

Import `GitPullRequest` from lucide-react.

**Step 2: Verify visually**

Run: `npm run dev`
Click GitHub dropdown. Should see quick action buttons between the primary action and the repo section.

**Step 3: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat: add quick actions section to GitHub dropdown"
```

---

### Task 8: Add branch list to GitHub dropdown

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 1: Add branch section after repo info**

Insert a new section after the repository info section, before the disconnect button:

```tsx
{/* Branches */}
{repoName && currentBranch && (
  <div className="border-b border-white/10">
    <div className="px-3 pt-2 pb-1">
      <div className="text-[10px] uppercase tracking-wider text-white/30">Branches</div>
    </div>
    <div className="px-1 pb-1.5">
      {/* Current branch */}
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-white/60">
        <GitBranch size={10} className="shrink-0 text-[var(--accent-cyan)]" />
        <span className="truncate flex-1">{currentBranch}</span>
        <span className="text-[9px] text-white/20">current</span>
      </div>
      {/* Other branches (max 5) */}
      {localBranches.slice(0, 5).map((branch) => (
        <button
          key={branch}
          onClick={async () => {
            if (!currentProject?.path) return
            setDropdownOpen(null)
            const targetDir = `${currentProject.path}/../${currentProject.name}-${branch}`
            try {
              const result = await window.api.worktree.checkout({
                projectPath: currentProject.path,
                branchName: branch,
                targetDir
              })
              const tabId = useTabsStore.getState().addTab({
                name: currentProject.name,
                path: result.path
              })
              useTabsStore.getState().updateTab(tabId, {
                worktreeBranch: result.branch,
                worktreePath: result.path
              })
              useToastStore.getState().addToast(`Switched to ${branch}`, 'success')
            } catch (err: any) {
              useToastStore.getState().addToast(`Failed: ${err?.message}`, 'error')
            }
          }}
          className="w-full flex items-center gap-2 px-2 py-1 text-xs text-left text-white/45 hover:bg-white/5 hover:text-white/70 rounded transition"
        >
          <GitBranch size={10} className="shrink-0" />
          <span className="truncate flex-1">{branch}</span>
        </button>
      ))}
      {localBranches.length > 5 && (
        <div className="px-2 py-1 text-[10px] text-white/20">
          +{localBranches.length - 5} more
        </div>
      )}
    </div>
    {/* Change repo link */}
    {!showLinkRepo && !showRepoInput && (
      <button
        onClick={() => {
          setShowLinkRepo(false)
          setShowRepoInput(false)
          openLinkRepo()
        }}
        className="w-full px-3 py-1.5 text-[10px] text-white/25 hover:text-white/45 transition border-t border-white/5"
      >
        Change repo...
      </button>
    )}
  </div>
)}
```

**Step 2: Verify visually**

Run: `npm run dev`
GitHub dropdown should show current branch highlighted in cyan, with other local branches listed below.

**Step 3: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat: add branch list to GitHub dropdown"
```

---

### Task 9: Rebuild Vercel dropdown — disconnected state

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 1: Replace the Vercel disconnected UI**

Find the Vercel dropdown's connect/disconnect section (around lines 1149-1163). Replace the disconnected state with:

```tsx
{status.vercel ? (
  <button
    onClick={() => disconnectService('vercel')}
    className="w-full px-3 py-2 text-xs text-left text-white/30 hover:bg-white/5 hover:text-white/50 transition"
  >
    Disconnect
  </button>
) : (
  <div className="p-4 text-center">
    <Triangle size={24} className="mx-auto mb-2.5 text-white/20" />
    <p className="text-xs text-white/40 mb-3 leading-relaxed">
      Deploy your app and get a<br />live URL in seconds.
    </p>
    <button
      onClick={() => connectService('vercel')}
      className="w-full py-2 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-colors"
    >
      Connect to Vercel
    </button>
  </div>
)}
```

**Step 2: Verify visually**

Run: `npm run dev`
Disconnect Vercel, click the triangle icon. Should see centered CTA.

**Step 3: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat: redesign Vercel dropdown disconnected state"
```

---

### Task 10: Rebuild Vercel dropdown — deployment status section

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 1: Add state for recent deployments**

Add near the existing Vercel state:

```typescript
const [recentDeploys, setRecentDeploys] = useState<Array<{
  id: string; url: string; state: string; created: number; source: string | null
}>>([])
```

**Step 2: Fetch recent deployments when dropdown opens**

Update the existing `useEffect` that fires when the Vercel dropdown opens (around line 484-502). After `fetchLinkedProject()`, also fetch recent deployments:

```typescript
// Inside the existing effect for dropdownOpen === 'vercel'
if (linkedProject?.project?.id) {
  window.api.oauth.vercel.deployments(linkedProject.project.id).then((result) => {
    if (Array.isArray(result)) {
      setRecentDeploys(result.slice(1, 4)) // Skip the latest (already shown), take next 3
    }
  })
}
```

Note: This needs to run after `fetchLinkedProject` resolves. Consider adding it inside `fetchLinkedProject` callback or using a separate effect that depends on `linkedProject`.

**Step 3: Rebuild the linked project section**

Replace the existing linked project display (the `linkedProject ? (...)` block inside the Vercel dropdown) with the new deployment status layout:

```tsx
{linkedProject ? (
  <>
    {/* Deployment status rows */}
    <div className="px-3 py-2.5 border-b border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">
        Deployments
      </div>

      {/* Production */}
      <div className="flex items-center gap-2 mb-1">
        <Circle size={6} className={`shrink-0 ${
          linkedProject.latestDeployment
            ? deployStateColor(linkedProject.latestDeployment.state)
            : 'text-white/20 fill-white/20'
        }`} />
        <span className="text-[10px] text-white/40 w-16 shrink-0">Production</span>
        <span className={`text-xs font-medium flex-1 ${
          linkedProject.latestDeployment
            ? deployStateColor(linkedProject.latestDeployment.state).split(' ')[0]
            : 'text-white/30'
        }`}>
          {linkedProject.latestDeployment
            ? deployStateLabel(linkedProject.latestDeployment.state)
            : 'No deploys'}
        </span>
        {linkedProject.latestDeployment && (
          <span className="text-[10px] text-white/20 shrink-0">
            {timeAgo(linkedProject.latestDeployment.created)}
          </span>
        )}
      </div>

      {/* Production URL */}
      <a
        href={linkedProject.project.productionUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 ml-4 text-[10px] text-[var(--accent-cyan)]/60 hover:text-[var(--accent-cyan)] transition-colors"
      >
        <span className="truncate">
          {linkedProject.project.productionUrl.replace('https://', '')}
        </span>
        <ExternalLink size={8} className="shrink-0 opacity-50" />
      </a>
    </div>

    {/* Quick actions */}
    <div className="border-b border-white/10">
      <button
        onClick={async () => {
          if (!linkedProject.latestDeployment) return
          const { addToast } = useToastStore.getState()
          const result = await window.api.oauth.vercel.redeploy(linkedProject.latestDeployment.id)
          if ('error' in result) {
            addToast(`Redeploy failed: ${result.error}`, 'error')
          } else {
            addToast('Redeploying...', 'success')
            setTimeout(fetchLinkedProject, 3000)
          }
        }}
        disabled={!linkedProject.latestDeployment}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition disabled:opacity-30"
      >
        <RefreshCw size={11} className="shrink-0" />
        Redeploy
      </button>
      <button
        onClick={() => {
          const url = `https://vercel.com/${vercelUser?.username}/${linkedProject.project.name}`
          window.open(url, '_blank')
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
      >
        <ExternalLink size={11} className="shrink-0" />
        <span className="flex-1">Open Dashboard</span>
        <kbd className="text-[9px] text-white/15 font-mono">⌘⇧V</kbd>
      </button>
      <button
        onClick={() => {
          const url = `https://vercel.com/${vercelUser?.username}/${linkedProject.project.name}/settings/domains`
          window.open(url, '_blank')
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
      >
        <Globe size={11} className="shrink-0" />
        Manage Domains
      </button>
      <button
        onClick={() => {
          if (linkedProject.latestDeployment) {
            // Open build logs in canvas panel instead of inline
            setDropdownOpen(null)
            useWorkspaceStore.getState().openCanvas()
            // Build logs rendering in canvas is a future enhancement
            // For now, open in external browser
            window.open(
              `https://vercel.com/${vercelUser?.username}/${linkedProject.project.name}/deployments/${linkedProject.latestDeployment.id}`,
              '_blank'
            )
          }
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
      >
        <FileText size={11} className="shrink-0" />
        View Build Logs
      </button>
    </div>

    {/* Recent deploys */}
    {recentDeploys.length > 0 && (
      <div className="border-b border-white/10">
        <div className="px-3 pt-2 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-white/30">Recent</div>
        </div>
        <div className="px-1 pb-1.5">
          {recentDeploys.map((deploy) => (
            <a
              key={deploy.id}
              href={deploy.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1 text-xs text-white/45 hover:bg-white/5 rounded transition"
            >
              <Circle size={5} className={`shrink-0 ${deployStateColor(deploy.state)}`} />
              <span className="truncate flex-1 text-[11px]">
                {deploy.source ? `"${deploy.source}"` : 'Deployment'}
              </span>
              <span className="text-[10px] text-white/20 shrink-0">
                {timeAgo(deploy.created)}
              </span>
            </a>
          ))}
        </div>
      </div>
    )}
  </>
)}
```

Import `RefreshCw` from lucide-react.

**Step 4: Remove old build logs inline UI**

Remove the `showBuildLogs` state, `loadingBuildLogs` state, `buildLogs` state, the `fetchBuildLogs` callback, and all the build-logs-in-dropdown rendering code. These are no longer needed since logs now open externally.

**Step 5: Verify visually**

Run: `npm run dev`
Vercel dropdown with a linked project should show:
- Deployment status row with colored dot
- Production URL
- Quick actions (Redeploy, Open Dashboard, Manage Domains, View Build Logs)
- Recent deploys list

**Step 6: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat: rebuild Vercel dropdown with deployment status and quick actions"
```

---

### Task 11: Add global keyboard shortcuts

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx` (add effect)

**Step 1: Add keyboard shortcut effect**

Add a `useEffect` inside the `ServiceIcons` component:

```typescript
// Global keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd+Shift+G — Open on GitHub
    if (e.metaKey && e.shiftKey && e.key === 'G') {
      e.preventDefault()
      if (repoName) {
        window.open(`https://github.com/${repoName}`, '_blank')
      }
    }
    // Cmd+Shift+V — Open Vercel Dashboard
    if (e.metaKey && e.shiftKey && e.key === 'V') {
      e.preventDefault()
      if (status.vercel && vercelUser && linkedProject) {
        window.open(
          `https://vercel.com/${vercelUser.username}/${linkedProject.project.name}`,
          '_blank'
        )
      }
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [repoName, status.vercel, vercelUser, linkedProject])
```

**Step 2: Verify manually**

Run: `npm run dev`
- With GitHub connected and repo linked: `Cmd+Shift+G` should open repo on GitHub
- With Vercel connected and project linked: `Cmd+Shift+V` should open Vercel dashboard

**Step 3: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat: add Cmd+Shift+G and Cmd+Shift+V keyboard shortcuts"
```

---

### Task 12: Clean up removed state and unused code

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

**Step 1: Remove dead state variables**

Remove these state variables and their associated code since build logs are no longer inline:

- `showBuildLogs` / `setShowBuildLogs`
- `loadingBuildLogs` / `setLoadingBuildLogs`
- `buildLogs` / `setBuildLogs`
- `showImportOptions` / `setShowImportOptions`
- The `fetchBuildLogs` callback

Also remove the `ChevronDown` and `ChevronRight` imports from lucide-react if they are no longer used elsewhere in the file.

**Step 2: Verify no regressions**

Run: `npm test -- --run`
Run: `npm run dev`
Verify both dropdowns still work correctly.

**Step 3: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "refactor: remove dead build-logs-inline state from ServiceIcons"
```

---

### Task 13: Final visual verification and polish

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx` (minor tweaks only)

**Step 1: Test all dropdown states**

Verify each state visually by running `npm run dev`:

| State | Expected |
|-------|----------|
| GitHub disconnected | Centered CTA with value prop |
| GitHub connected, no repo | Username header + Link/Create repo buttons |
| GitHub connected, repo linked, up to date | "Up to date" badge + quick actions + branches |
| GitHub connected, repo linked, ahead | "Push N commits" primary action |
| GitHub connected, repo linked, behind | "Pull N commits" primary action |
| GitHub connected, repo linked, PR exists | "PR #N" quick action link |
| Vercel disconnected | Centered CTA with value prop |
| Vercel connected, no project linked | Import button + project list |
| Vercel connected, project linked | Deployment status + quick actions + recent deploys |

**Step 2: Fix any visual issues**

Adjust padding, font sizes, colors, or spacing as needed for visual consistency.

**Step 3: Run full test suite**

Run: `npm test -- --run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "polish: finalize service dropdown redesign"
```
