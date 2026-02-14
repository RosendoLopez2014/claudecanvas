# Service Dropdowns Redesign — "Command Center" Approach

**Date:** 2026-02-14
**Status:** Approved
**Scope:** GitHub and Vercel dropdown menus in `ServiceIcons.tsx`

## Problem

The current GitHub and Vercel dropdowns are connection-management panels. They show whether you're connected and let you link repos/projects, but they don't help users *do things*. Key gaps:

- **GitHub:** No quick actions (open repo, create PR, view issues), no branch context, no sync state, no PR awareness
- **Vercel:** No redeploy action, no deployment history (only latest), build logs crammed into dropdown, no "Open Dashboard" shortcut, no domain management
- **Both:** No contextual primary action, no temporal context ("last pushed X ago"), no keyboard shortcuts

## Research

Competitive analysis of GitHub Desktop, VS Code, Vercel Dashboard, Railway, Replit, Netlify, and Cursor revealed these patterns used by the best developer tools:

| Pattern | Used By | Application |
|---------|---------|-------------|
| Contextual primary action button | GitHub Desktop, VS Code | Single button that changes label based on state (Push/Pull/Publish) |
| Status at a glance | VS Code, Railway, Netlify | Color-coded dots + counts visible without extra clicks |
| Progressive disclosure | Railway, Vercel | Overview -> detail -> logs, each level reveals more |
| Temporal context | GitHub Desktop, Vercel | "Last fetched 2m ago", "Deployed 3m ago" |
| Smart empty states | VS Code, Replit | Single CTA with value prop, not disabled connected UI |
| Keyboard shortcuts | Vercel (Cmd+K), VS Code | Direct shortcuts that bypass menus entirely |

## Design

### GitHub Dropdown

#### Connected + Repo Linked State

```
┌─────────────────────────────────────────┐
│  ◉ rosendolopez                         │
│  github.com/rosendolopez/my-app         │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  ↑ Push 3 commits                  ││
│  │  Last pushed 12m ago               ││
│  └─────────────────────────────────────┘│
│                                         │
├─────────────────────────────────────────┤
│  ⊕ Create Pull Request                  │
│  ⊞ Open on GitHub              ⌘⇧G     │
│  ⊞ View Issues                          │
├─────────────────────────────────────────┤
│  BRANCHES                               │
│  main ← current                         │
│  ├ feat/auth (2 ahead)                  │
│  └ fix/typo                             │
│  Change repo...                         │
├─────────────────────────────────────────┤
│  Disconnect                             │
└─────────────────────────────────────────┘
```

#### Contextual Primary Action States

The primary action button at the top of the dropdown changes based on git state:

| State | Button Label | Subtitle | Action |
|-------|-------------|----------|--------|
| Commits ahead of remote | `↑ Push N commits` | Last pushed Xm ago | Triggers push flow |
| Commits behind remote | `↓ Pull N commits` | Last fetched Xm ago | Triggers pull |
| Both ahead and behind | `↕ Sync (N↑ M↓)` | Last fetched Xm ago | Pull then push |
| Up to date | `✓ Up to date` | Last pushed Xm ago | Disabled/fetch |
| No remote configured | `Publish branch` | Set up a remote to push | Opens link/create repo |
| Branch not published | `Publish branch` | Push to origin/branch-name | Pushes branch |

#### Quick Actions (Contextual)

Actions appear/hide based on state:

| Action | Visible When |
|--------|-------------|
| Create Pull Request | Ahead of remote, no open PR on current branch |
| View Open PR #N | Open PR exists for current branch |
| Open on GitHub | Repo is linked (always) |
| View Issues | Repo is linked (always) |

#### Connected + No Repo State

```
┌─────────────────────────────────────────┐
│  ◉ rosendolopez                         │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐│
│  │  Publish branch                    ││
│  │  Set up a remote to push           ││
│  └─────────────────────────────────────┘│
├─────────────────────────────────────────┤
│  Link Existing Repo                     │
│  Create New Repo                        │
├─────────────────────────────────────────┤
│  Disconnect                             │
└─────────────────────────────────────────┘
```

#### Disconnected State

```
┌─────────────────────────────────────────┐
│       GitHub                            │
│                                         │
│  Push code, create PRs, and             │
│  collaborate with your team.            │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │     Connect to GitHub               ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

#### Branch List

Shows local branches with sync indicators. Clicking a branch triggers worktree checkout (reuses existing NewTabMenu logic). Limited to 5 branches; "Show all..." expands.

---

### Vercel Dropdown

#### Connected + Project Linked State

```
┌─────────────────────────────────────────┐
│  ▲ Rosendo Lopez                        │
│    @rosendolopez · my-app               │
├─────────────────────────────────────────┤
│  DEPLOYMENTS                            │
│                                         │
│  ● Production    Ready       2m ago     │
│    my-app.vercel.app            ↗       │
│                                         │
│  ○ Preview       Building    just now   │
│    my-app-git-feat.vercel.app   ↗       │
├─────────────────────────────────────────┤
│  ↻ Redeploy                             │
│  ⊞ Open Dashboard             ⌘⇧V      │
│  🌐 Manage Domains                      │
│  📋 View Build Logs                     │
├─────────────────────────────────────────┤
│  RECENT                                 │
│  ● "fix: auth bug"            12m ago   │
│  ✕ "feat: new page"            1h ago   │
│  ● "update deps"              3h ago    │
├─────────────────────────────────────────┤
│  Disconnect                             │
└─────────────────────────────────────────┘
```

#### Deployment Status Section

Shows up to 2 environment rows:
- **Production**: Always shown when project is linked. Shows state dot, label, time ago, and clickable URL.
- **Preview**: Only shown when a preview deployment exists (e.g., from a branch push). Auto-hides when no preview is active.

State colors follow existing `deployStateColor` function (green/amber/red/cyan/grey).

#### Quick Actions

| Action | Behavior |
|--------|----------|
| Redeploy | Triggers redeploy of production via Vercel API (new IPC handler needed) |
| Open Dashboard | Opens Vercel project dashboard in external browser |
| Manage Domains | Opens Vercel domains page in external browser |
| View Build Logs | Opens latest deployment's build logs in the **canvas panel** (not inline) |

#### Recent Deploys

Shows the 3 most recent deployments (after the currently-displayed production/preview). Each row: status dot, commit message (truncated), time ago. Clicking a row opens the deployment URL.

#### Connected + No Project Linked State

```
┌─────────────────────────────────────────┐
│  ▲ Rosendo Lopez                        │
│    @rosendolopez                        │
├─────────────────────────────────────────┤
│                                         │
│  No project linked                      │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  Import to Vercel                   ││
│  └─────────────────────────────────────┘│
│                                         │
│  YOUR PROJECTS                          │
│  search...                              │
│  ▲ my-app          next      ↗          │
│  ▲ blog            astro     ↗          │
│  ▲ api-server      node      ↗          │
├─────────────────────────────────────────┤
│  Disconnect                             │
└─────────────────────────────────────────┘
```

#### Disconnected State

```
┌─────────────────────────────────────────┐
│       Vercel                            │
│                                         │
│  Deploy your app and get a live         │
│  URL in seconds.                        │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │     Connect to Vercel               ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

---

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+G` | Open repo on GitHub (if linked) |
| `Cmd+Shift+V` | Open project on Vercel Dashboard (if linked) |

These work globally, not just when the dropdown is open.

### Data Requirements

New data needed beyond what's currently fetched:

| Data | Source | Notes |
|------|--------|-------|
| Git sync state (ahead/behind) | Already exists in tab store | Reuse `gitAhead`, `gitBehind` |
| Current branch | Already exists in tab store | Reuse `worktreeBranch` |
| Local branches | `git branch` via IPC | New IPC handler or reuse NewTabMenu logic |
| Open PR for current branch | `gh pr view` via IPC | New IPC handler needed |
| Last push timestamp | Track in tab store on push | New field |
| Last fetch timestamp | Track in tab store on fetch | New field |
| Preview deployment | Vercel API `deployments` endpoint | Filter by branch name |
| Recent deployments (3) | Vercel API `deployments` endpoint | Already have `deployments` IPC handler |
| Redeploy action | Vercel API `POST /deployments` | New IPC handler needed |

### Implementation Notes

- Build logs should open in the canvas panel as an iframe or rendered component, not inside the dropdown
- The contextual primary action button reuses the existing push/pull flows from `StatusBar` and `PushPopover`
- Branch list reuses `NewTabMenu` branch-fetching logic
- PR detection can use the existing `gh` CLI that's already configured with the user's token
- Keyboard shortcuts registered via `useEffect` in the main App component or a dedicated shortcuts hook
- Dropdown width stays at 320px (current Vercel dropdown is already 320px)
