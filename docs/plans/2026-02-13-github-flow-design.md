# GitHub Flow — Design Document

## Goal

Add push, pull, and one-click PR creation to Claude Canvas so teams (and solo devs) can sync with GitHub without leaving the app.

## Architecture

simple-git in the main process handles all git operations (push, pull, fetch, squash). GitHub REST API (using the stored OAuth token) handles PR creation. StatusBar gets sync indicators and a push popover with AI-generated commit messages. Auto-fetch runs in the background; pull and push are manual.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Commit strategy | Squash checkpoints on push | Keeps remote history clean; checkpoints stay as local undo |
| Pull strategy | Stash → pull --rebase → stash pop | Linear history, safe with uncommitted work |
| Conflict resolution | Toast + defer to Claude Code in terminal | Avoids building a visual merge editor |
| Sync timing | Auto-fetch on tab focus + every 3 min; manual pull/push | Industry standard (VS Code pattern) |
| Commit messages | AI-generated via `claude --print` | Zero friction; user can edit before pushing |
| PR creation | One-click after branch push, everything auto-filled | Optional; only prompted on feature branches |
| UI location | StatusBar (bottom bar) | Always visible, compact, consistent with existing controls |
| Git backend | simple-git (existing) + GitHub REST API for PRs | Consistent with current architecture |

## Push Flow

1. User clicks **Push** (↑ indicator) in StatusBar
2. App computes diff: `git diff origin/<branch>...HEAD --stat`
3. Spawns `claude --print` with the diff to generate a commit message (2-3 sec)
4. **Push popover** appears anchored to the button (opens upward):
   - Text input pre-filled with AI-generated message, loading spinner while generating
   - "Push" button
5. On submit:
   - `git reset --soft origin/<branch>` — un-commits all checkpoints, keeps files staged
   - `git commit -m "<message>"` — one squashed commit
   - `git push origin <branch>`
   - Success toast
6. If push rejected (remote ahead): auto-trigger pull, then retry push
7. **Branch-aware toast:**
   - Pushing to `main`: `"✓ Pushed to origin/main"` — done
   - Pushing to feature branch: `"✓ Pushed to origin/feature-branch  [Create PR]  [✕]"` — PR optional

## Pull Flow

1. **Auto-fetch** runs on tab focus and every 3 minutes (silent, background)
2. Compares: `git rev-list HEAD..origin/<branch> --count`
3. If behind, StatusBar shows **↓ 3 Pull** badge
4. User clicks Pull:
   - `git stash` (if uncommitted changes)
   - `git pull --rebase origin/<branch>`
   - `git stash pop` (if stashed)
   - Toast: `"✓ Pulled 3 commits from origin"`
5. If conflicts after stash pop:
   - Yellow warning toast: `"Conflicts detected — resolve in terminal"`
   - Claude Code in the terminal can handle resolution

## PR Creation

Triggered by clicking "Create PR" in the post-push toast (feature branches only).

1. **Auto-filled, no form:**
   - Title = commit message from push
   - Description = AI-generated from diff via `claude --print`
   - Base branch = `main`
2. One API call: `POST /repos/{owner}/{repo}/pulls`
3. Toast: `"✓ PR #42 created"` with clickable link (opens in browser)

**Not building:** reviewers, labels, draft PRs, PR list/merge UI.

## StatusBar Layout

```
[ProjectName ▸ main]  [branch]    ...    [↓3 Pull] [↑2 Push] [Start] [Canvas] [Inspector]
```

**States:**
- `↓ N Pull` — behind remote, click to pull (only shows when N > 0)
- `↑ N Push` — unpushed checkpoints, click to open push popover (subtle pulsing dot as nudge; only shows when N > 0)
- `✓ Synced` — up to date, dim text
- Spinner + "Pulling..." / "Pushing..." during operations
- `No remote` — dim text when no origin configured, push/pull hidden
- `Connect GitHub` — link to ServiceIcons when not authenticated

## Error Handling

| Error | Behavior |
|-------|----------|
| Push rejected (remote ahead) | Auto-pull, then retry push |
| Pull conflicts | Yellow toast: "Conflicts detected — resolve in terminal" |
| Network failure | Red toast: "Network error — check connection" |
| No remote configured | Hide push/pull, show "No remote" |
| Not authenticated | Show "Connect GitHub" link |
| `claude --print` fails/times out | Fall back to empty input, user types manually |
| PR creation fails | Red toast with error message |

## New Main Process Handlers

| Handler | Operation |
|---------|-----------|
| `git:fetch` | `git fetch origin`, return `{ ahead, behind }` counts |
| `git:pull` | Stash → pull --rebase → stash pop, return `{ success, conflicts }` |
| `git:push` | `git push origin <branch>`, return `{ success, error }` |
| `git:squashAndPush` | Reset --soft → commit → push, return `{ success, error }` |
| `git:generateCommitMessage` | Spawn `claude --print` with diff, return message string |
| `git:createPr` | GitHub API POST, return `{ url, number }` |

## New Preload Bridge Methods

```typescript
git: {
  // ... existing methods ...
  fetch: (projectPath: string) => Promise<{ ahead: number; behind: number }>
  pull: (projectPath: string) => Promise<{ success: boolean; conflicts: boolean }>
  push: (projectPath: string) => Promise<{ success: boolean; error?: string }>
  squashAndPush: (projectPath: string, message: string) => Promise<{ success: boolean; error?: string }>
  generateCommitMessage: (projectPath: string) => Promise<string>
  createPr: (projectPath: string, opts: { title: string; body: string; base: string }) =>
    Promise<{ url: string; number: number } | { error: string }>
}
```

## New Tab State Fields

```typescript
// Added to TabState in stores/tabs.ts
gitAhead: number       // commits ahead of remote (unpushed)
gitBehind: number      // commits behind remote
gitSyncing: boolean    // true during fetch/pull/push operations
```

## New Renderer Components

- **`useGitSync` hook** — auto-fetch on tab focus + 3-min interval, stores counts in tab state
- **`PushPopover`** — floating card anchored to Push button with AI commit message input
- **StatusBar git section** — sync indicators, pull/push buttons, states

## Out of Scope (YAGNI)

- Visual merge/conflict editor
- PR list, review, or merge UI
- Branch management UI (worktrees handle this)
- Commit history browser beyond existing Timeline
- Draft PRs, reviewers, labels, assignees
- GitHub Actions / CI status
