# Claude Canvas Upgrade — Design Document

> **Date:** 2026-02-14
> **Scope:** Full platform hardening + feature expansion (56 tasks across 2 plans)
> **Goal:** Transform Claude Canvas from a solid prototype into a production-ready daily driver that reduces token usage, eliminates context-switching, and makes AI-powered development feel effortless.

---

## The Ideal User

**Who they are:** A developer who uses Claude Code daily to build web applications. They've tried Cursor, VS Code + Claude extension, and raw Claude Code in the terminal. They want a single environment where ideas become deployed apps with minimal friction.

**What they want:**
- **Zero context-switching.** Terminal, preview, git, deploy — all in one window. No more juggling VS Code, Chrome, GitHub Desktop, and Vercel dashboard.
- **Visual feedback as they code.** When Claude makes changes, they see the result instantly — not after manually refreshing a browser tab.
- **Invisible git.** Commits, pushes, and PRs happen with one click. Branches are visual tabs, not terminal commands to remember.
- **Token efficiency.** Every interaction should be optimized. Claude shouldn't waste tokens asking "what does the UI look like?" when a screenshot is one API call away.
- **Smart defaults, escape hatches.** The app should auto-detect frameworks, auto-start dev servers, auto-checkpoint changes — but never lock the user out of the terminal when they need full control.

**What frustrates them today:**
- Claude Code can't see the app it's building (no visual context)
- Usage limits hit mid-session with zero warning
- Permission prompts interrupt flow every 30 seconds
- Small components open a full canvas panel instead of rendering inline
- Errors require copy-pasting 500-token stack traces
- Project setup is manual (empty folder, no templates, no framework detection)
- No settings UI — can't configure dev commands, font size, or shortcuts
- Can't search files, can't see project structure, can't find anything without the terminal

**Their dream workflow:**
```
1. Open Claude Canvas → pick "Next.js" template → project scaffolded
2. Terminal launches Claude Code → canvas shows live preview
3. "Make the header sticky with a blur backdrop"
4. Claude edits → preview updates instantly → checkpoint auto-created
5. Click "Push" → AI generates commit message → squash-and-push
6. Toast: "Pushed to origin/feat/sticky-header" [Create PR]
7. Click → PR created → toast: "PR #42 created" [Open] [Deploy]
8. Click Deploy → Vercel build streams in canvas → preview URL in toast
9. Done. Idea → deployed in 10 minutes.
```

---

## Audit Findings Summary

Five parallel agents audited the entire codebase across architecture, canvas system, UX, MCP/token efficiency, and Claude Code community issues.

### Critical Bugs Found

| # | Bug | Impact | Location |
|---|-----|--------|----------|
| 1 | Git instances accumulate forever in a Map | Memory leak compounds with worktrees | `services/git.ts:8` |
| 2 | `closeTab()` never calls `cleanupTabResources()` | PTY, dev server, file watcher all leak on tab close | `stores/tabs.ts:116` |
| 3 | File watchers created per-tab but never removed | CPU drain from stale watchers | `main/watcher.ts` |
| 4 | `treeKill` not awaited in dev server stop | Zombie processes, port conflicts | `services/dev-server.ts:267` |
| 5 | OAuth flows share mutable globals | Concurrent auth breaks both flows | `oauth/github.ts:11` |
| 6 | **Inline rendering is dead code** — core vision unfulfilled | All renders open canvas panel, even for 50px buttons | `useMcpCommands.ts` |
| 7 | Tab state persisted to disk but never restored | Users lose all tabs on every restart | `stores/tabs.ts:84` |
| 8 | `.catch(() => {})` swallows errors in 6+ locations | Silent failures with no debugging path | `mcp/server.ts`, git, etc. |
| 9 | Inspector matches any localhost iframe | Could inject into wrong application | `main/inspector.ts:391` |
| 10 | No IPC input validation | Potential command injection via PTY | `main/pty.ts:11` |

### Canvas Utilization: ~40%

| Working | Not Working / Missing |
|---------|----------------------|
| Live iframe preview | Inline terminal rendering (dead code) |
| Gallery (manual add) | Auto-populate from component files |
| Timeline (manual checkpoint) | Auto-checkpoint every N changes |
| Text diff | Auto-open diff after checkpoint |
| Inspector (full context) | Minimal context mode for tokens |
| Desktop/mobile viewport | Breakpoint presets (iPhone, iPad, custom) |
| Screenshot (manual drag) | Error screenshot auto-capture |
| MCP tools (11 total) | `auto_screenshot`, `get_context_minimal`, `get_errors` |

### Token Waste Analysis

| Source | Current Cost | Optimized Cost | Savings |
|--------|-------------|----------------|---------|
| `canvas_get_context` (full) | 200-600 tokens/call | 30-50 tokens/call (minimal mode) | 80% |
| `canvas_get_status` (all state) | 100-200 tokens/call | 10-20 tokens/call (focused tools) | 85% |
| UI clarification questions | 300-800 tokens/exchange | 0 (auto-screenshot) | 100% |
| Error stack traces | 500-2000 tokens/paste | 50 tokens (parsed error) | 90% |
| **Total per session** | ~3250 tokens | ~450 tokens + images | **~85%** |

### Claude Code Community Issues Addressed

| Issue | Community Signal | Our Solution |
|-------|-----------------|-------------|
| Can't see the app (#10646) | Multiple 3rd-party tools built | Canvas + auto-screenshot |
| Need lightweight IDE (#24300) | 4M+ VS Code installs | Claude Canvas IS this |
| Usage limit opacity (#16157) | 529 upvotes, 1,182 comments | Token usage dashboard |
| Terminal flickering (#3648) | 1,000+ combined upvotes | xterm.js WebGL + controlled buffering |
| Sycophancy (#3382) | 873 upvotes | Automated visual verification |
| Permission fatigue (#2560) | Multiple issues + blogs | Smart permission manager |
| Context exhaustion (#24498) | Multiple HN threads | Multi-tab sessions + worktrees |
| MCP config pain (#7328) | 200+ upvotes | Built-in config writer + OAuth |
| No undo/checkpoint (#353) | 178 reactions | Visual timeline + one-click rollback |
| Disk bloat (#24486) | Multiple issues | Session management + cleanup |

---

## Plan 1: Fixes & Hardening (18 tasks)

### Phase 1: Critical Memory Leaks & Race Conditions

**Task 1: Fix git instance memory leak**
- Add `git:cleanup` IPC handler that removes a path from the gitInstances Map
- Call it from `cleanupTabResources()` on tab close
- Clear entire Map on `app.on('window-all-closed')`
- Files: `services/git.ts`, `stores/tabs.ts`, `preload/index.ts`

**Task 2: Fix tab close resource cleanup**
- Make `closeTab()` call `cleanupTabResources()` before removing tab from state
- Since Zustand actions are synchronous, add `closeTabAsync()` that awaits cleanup then calls the sync `closeTab`
- Wire all close triggers (TabBar X button, Cmd+W) through `closeTabAsync`
- Files: `stores/tabs.ts`, `TabBar.tsx`, `useKeyboardShortcuts.ts`

**Task 3: Fix file watcher memory leak**
- Track watcher-to-tab mapping in main process
- Add `fs:unwatchTab` handler that cleans all watchers for a tab
- Call from `cleanupTabResources()`
- Files: `main/watcher.ts`, `stores/tabs.ts`, `preload/index.ts`

**Task 4: Fix dev server race condition**
- Wrap `treeKill` in a Promise that resolves on callback
- Add mutex (simple boolean flag per cwd) to prevent concurrent start/stop
- Await kill completion before deleting from devProcesses Map
- Files: `services/dev-server.ts`

**Task 5: Fix OAuth state collision**
- Replace mutable globals (`activeAuthView`, `pendingResolve`) with a per-service state Map
- Each OAuth flow gets its own state object keyed by service name
- Cancel previous flow before starting new one (with cleanup)
- Files: `oauth/github.ts`, `oauth/vercel.ts`

### Phase 2: Dead Code & Missing Wiring

**Task 6: Wire up inline rendering**
- Add `if (result.target === 'inline')` branch in `useMcpCommands` `onCanvasRender` handler
- Import and use `useInlineRender` hook from `InlineRender.tsx`
- Calculate rows needed, write blank lines, register xterm decoration with iframe
- Set workspace mode to `'terminal-inline'` when inline content is showing
- Files: `hooks/useMcpCommands.ts`, `components/Terminal/TerminalView.tsx`

**Task 7: Fix tab state restoration**
- Add `restoreTabs()` function that reads persisted tabs from settings
- Call on app startup in `App.tsx` after onboarding check
- Restore project info, worktree branch/path, but NOT runtime state (PTY, dev server)
- Auto-activate the first tab after restoration
- Files: `stores/tabs.ts`, `App.tsx`

### Phase 3: Error Handling & Validation

**Task 8: Fix silent error swallowing**
- Audit all `.catch(() => {})` patterns across codebase (6+ occurrences)
- Replace with `console.error` logging at minimum
- Surface critical failures (MCP server, OAuth) via IPC to renderer for toast display
- Files: `mcp/server.ts`, `oauth/*.ts`, `services/git.ts`

**Task 9: Add IPC input validation**
- Validate `projectPath` is an absolute path string in all git/dev/fs handlers
- Validate `shell` parameter in PTY spawn (allow-list of known shells)
- Validate `cwd` exists as a directory before PTY spawn
- Return structured errors, not thrown exceptions
- Files: `main/pty.ts`, `services/dev-server.ts`, `services/git.ts`

**Task 10: Fix inspector frame validation**
- Match iframe by expected port from tab state, not just "any localhost"
- Optionally set `name` attribute on canvas iframe for precise matching
- Files: `main/inspector.ts`, `components/Canvas/CanvasPanel.tsx`

**Task 11: Fix PTY buffer error handling**
- Wrap `win.webContents.send()` in try/catch
- Log failures with PTY id and buffer size
- Don't silently clear buffer on send failure; retry once on next tick
- Files: `main/pty.ts`

### Phase 4: Token Optimization MCP Tools

**Task 12: Add `canvas_auto_screenshot` MCP tool**
- New MCP tool that captures the current canvas preview as an image
- Returns base64 PNG via MCP image content type
- Claude can call this proactively to see the UI state
- Files: `mcp/tools.ts`, `main/screenshot.ts`

**Task 13: Add `canvas_get_context_minimal` MCP tool**
- Returns only `{ filePath, lineNumber, componentName }` per element
- 30-50 tokens instead of 200-600
- Claude calls this first, only calls full `canvas_get_context` when it needs props/styles
- Files: `mcp/tools.ts`

**Task 14: Split `canvas_get_status` into focused tools**
- `canvas_is_dev_running` → returns `"yes"` or `"no"`
- `canvas_get_preview_url` → returns URL string or `"none"`
- `canvas_get_active_tab` → returns tab name
- Keep original `canvas_get_status` for backward compat but mark as verbose
- Update CLAUDE.md to prefer focused tools
- Files: `mcp/tools.ts`, `mcp/config-writer.ts`

**Task 15: Add `canvas_get_errors` MCP tool**
- Inject `window.onerror` and `console.error` listener into preview iframe
- Store latest errors in renderer state
- MCP tool returns parsed errors: `{ message, file, line, column }` (~50 tokens)
- Falls back to "no errors" if iframe is healthy
- Files: `mcp/tools.ts`, `inspector/overlay.ts`, `hooks/useMcpCommands.ts`, `stores/canvas.ts`

### Phase 5: State Management Cleanup

**Task 16: Consolidate state stores**
- Add `@deprecated` JSDoc comments to old store actions that duplicate TabState
- Wire StatusBar, Workspace, Canvas components to read from `useTabsStore.getActiveTab()` instead of individual stores
- Ensure all state updates go through `updateTab()` for the active tab
- Files: `stores/canvas.ts`, `stores/project.ts`, `stores/workspace.ts`, all consumers

**Task 17: Extract magic numbers**
- Named constants for: PTY buffer interval (8ms), OAuth timeout (600000ms), dev server timeout (20000ms), inline render threshold (400x200), fetch interval (180000ms)
- Centralize in `src/shared/constants.ts`
- Files: All files with magic numbers, new `constants.ts`

**Task 18: Final verification**
- Full production build (`npx electron-vite build`)
- All tests pass (`npm test`)
- Manual smoke test of all fixed behaviors
- Commit all fixes

---

## Plan 2: Features (38 tasks)

### Phase 1: Project Templates & Onboarding (3 tasks)

**Task 1: Template gallery in project creation**
- Add template selection step to project creation flow
- Templates: Next.js (App Router), Vite + React, Astro, SvelteKit, Blank
- Each template: `npx create-*` with sensible defaults
- Show template cards with framework icons and descriptions
- Files: `components/Onboarding/ProjectPicker.tsx`, new `services/templates.ts`

**Task 2: Framework detection for existing projects**
- On project open, scan for `package.json`, detect framework (next, vite, astro, etc.)
- Auto-set dev command based on framework
- Store detected framework + dev command in project settings
- Files: new `services/framework-detect.ts`, `stores/project.ts`

**Task 3: Enhanced onboarding wizard**
- Add "What Canvas does" screen with animated terminal + canvas demo
- Create first project during onboarding (template selection built in)
- Show keyboard shortcut highlights
- Files: `components/Onboarding/Wizard.tsx`

### Phase 2: Token Usage Dashboard (3 tasks)

**Task 4: Token usage tracking**
- Parse Claude Code CLI output for token usage indicators
- Track tokens consumed per session, per tab
- Store in tab state + persist daily totals
- Files: new `hooks/useTokenTracking.ts`, `stores/tabs.ts`

**Task 5: StatusBar token gauge**
- Visual gauge showing estimated usage (green/yellow/red)
- Click to expand: session tokens, daily tokens, estimated remaining
- Files: new `components/StatusBar/TokenGauge.tsx`, `StatusBar.tsx`

**Task 6: Usage warning system**
- Toast at 80% estimated usage: "Running low on tokens — consider splitting your session"
- Suggest opening a new tab for independent work
- Files: `hooks/useTokenTracking.ts`, `stores/toast.ts`

### Phase 3: Canvas Power (6 tasks)

**Task 7: Responsive breakpoint presets**
- Replace desktop/mobile toggle with dropdown menu
- Presets: iPhone SE (375), iPhone 14 (390), iPhone 14 Pro Max (430), iPad Mini (768), iPad (1024), Laptop (1280), Desktop (1440), Custom (input)
- Store selected preset in tab state
- Files: `components/Canvas/CanvasPanel.tsx`, `stores/tabs.ts`

**Task 8: Auto-render on component creation**
- File watcher detects new `.tsx`/`.jsx` files in `src/components/`
- Parse default export, generate minimal render HTML
- Auto-add to gallery with component name as label
- Files: `hooks/useMcpCommands.ts`, new `services/component-parser.ts`

**Task 9: Error overlay in canvas**
- Inject error boundary into preview iframe
- Capture runtime errors with stack trace
- Render styled error overlay (like Next.js error overlay)
- Store errors in canvas state for `canvas_get_errors` MCP tool
- Files: `inspector/overlay.ts`, `stores/canvas.ts`, `hooks/useMcpCommands.ts`

**Task 10: Console log overlay**
- Inject `console.log/warn/error` interceptor into preview iframe
- Show log panel at bottom of canvas (collapsible)
- Color-coded by level, timestamps, expandable objects
- Files: new `components/Canvas/ConsoleOverlay.tsx`, `inspector/overlay.ts`

**Task 11: Auto-close canvas on dev server exit**
- Listen for `dev:exit` event in `useMcpCommands`
- Close canvas panel, clear preview URL
- Show toast: "Dev server stopped"
- Files: `hooks/useMcpCommands.ts`

**Task 12: Auto-open diff after checkpoint**
- After `canvas_checkpoint` completes, switch canvas to diff tab
- Pre-select current checkpoint as "After" and previous as "Before"
- Files: `hooks/useMcpCommands.ts`, `stores/canvas.ts`

### Phase 4: Inspector Improvements (3 tasks)

**Task 13: Persistent inspector highlights**
- Selected elements keep cyan outline until explicitly cleared
- Add "Clear selection" button to inspector toolbar
- Highlight fades only on file change (HMR) after 2s debounce
- Files: `inspector/overlay.ts`, `hooks/useInspector.ts`

**Task 14: Visual indicator for inspector mode**
- Cyan top border on canvas panel when inspector active
- StatusBar shows "Inspector" badge in cyan
- Escape key hint overlay: "Click elements to inspect. Press ESC to exit."
- Files: `components/Canvas/CanvasPanel.tsx`, `components/StatusBar/StatusBar.tsx`

**Task 15: Enhanced inspector context**
- Add parent layout info: `parentDisplay`, `parentFlexDirection`, `parentGap`
- Add sibling count for context
- Add event handler names (onClick, onChange, etc.) from React fiber
- Files: `inspector/style-extractor.ts`, `inspector/fiber-walker.ts`

### Phase 5: Gallery & Timeline (4 tasks)

**Task 16: Gallery variant management**
- Delete button (X) on each gallery card
- Rename button (pencil icon) with inline text input
- Duplicate button (copy icon)
- Export button (download HTML file)
- Files: `components/Gallery/Gallery.tsx`, `stores/gallery.ts`

**Task 17: Auto-checkpoint every N file changes**
- Track file change count since last checkpoint
- Auto-create checkpoint after 5 changes (configurable in settings)
- Message: "Auto: N file changes"
- Disable-able in settings
- Files: `hooks/useMcpCommands.ts`, new `hooks/useAutoCheckpoint.ts`

**Task 18: Visual regression detection**
- On checkpoint, compare screenshot to previous checkpoint using pixelmatch
- If pixel diff exceeds threshold, mark checkpoint as "Visual change" in timeline
- Show diff percentage on timeline node
- Files: new `services/visual-diff.ts`, `components/CheckpointTimeline/Timeline.tsx`

**Task 19: One-click rollback from timeline**
- "Rollback" button on each checkpoint node
- Confirms: "Rollback to [message]? This will discard N changes."
- Executes `git reset --hard [hash]`
- Refreshes preview
- Files: `components/CheckpointTimeline/Timeline.tsx`, `services/git.ts`, `preload/index.ts`

### Phase 6: Git & DevOps (3 tasks)

**Task 20: Visual diff rollback button**
- Add "Revert this file" button per file in diff view
- Executes `git checkout [beforeHash] -- [filePath]`
- Refresh diff view after revert
- Files: `components/DiffView/DiffView.tsx`, `services/git.ts`, `preload/index.ts`

**Task 21: Deploy button with Vercel integration**
- "Deploy" button in StatusBar (visible when Vercel connected + on non-main branch)
- Flow: Push → Trigger deploy → Stream build logs in canvas → Toast with preview URL
- Uses existing Vercel OAuth token
- Files: `components/StatusBar/StatusBar.tsx`, `oauth/vercel.ts`, `preload/index.ts`

**Task 22: Smart permission manager**
- Settings panel section for per-project permissions
- Categories: File operations, Git operations, Shell commands, Network
- Granular rules: "Allow `npm install`", "Block `rm -rf`"
- Persist in electron-store per project path
- Inject into Claude Code via `--allowedTools` or CLAUDE.md
- Files: new `components/Settings/PermissionManager.tsx`, `stores/project.ts`, `mcp/config-writer.ts`

### Phase 7: UX & Navigation (5 tasks)

**Task 23: Expanded Quick Actions**
- Add 25+ commands organized by category:
  - **Dev:** Start/Stop server, Restart server, Open preview URL
  - **Git:** Commit, Push, Pull, Create branch, Switch branch, View log
  - **Canvas:** Toggle, Screenshot, Inspector, Gallery, Timeline, Diff
  - **Project:** Open in Finder, Open terminal, Settings, Search files
  - **Deploy:** Deploy to Vercel, View deployment status
- Add category headers and fuzzy search
- Files: `components/QuickActions/QuickActions.tsx`

**Task 24: Keyboard shortcut cheat sheet**
- Cmd+? opens modal overlay
- Grouped by category (Terminal, Canvas, Git, Navigation)
- Searchable
- Links to settings for customization
- Files: new `components/ShortcutSheet/ShortcutSheet.tsx`, `hooks/useKeyboardShortcuts.ts`

**Task 25: Settings UI panel**
- Accessible from StatusBar gear icon or Quick Actions
- Sections: General, Terminal, Canvas, Git, Services, Shortcuts
- Settings: dev command, font size, theme, auto-checkpoint interval, fetch interval
- Persisted in electron-store
- Files: new `components/Settings/Settings.tsx`, `stores/project.ts`

**Task 26: File explorer sidebar**
- Collapsible left sidebar (toggleable, default hidden)
- Read-only file tree using `fs.readdir` recursive
- Click file → copy path to terminal or open in default editor
- Ignore: `node_modules`, `.git`, `dist`, `.next`
- Keyboard shortcut: Cmd+B
- Files: new `components/FileExplorer/FileExplorer.tsx`, new `services/file-tree.ts`, `preload/index.ts`

**Task 27: Project-wide search**
- Cmd+Shift+F opens search panel
- Uses ripgrep (bundled with Claude Code) or Node.js `fs` fallback
- Results: file path, line number, matching line with highlight
- Click result → copy path to terminal
- Files: new `components/Search/Search.tsx`, new `services/search.ts`, `preload/index.ts`

### Phase 8: Terminal Enhancements (3 tasks)

**Task 28: Multiple terminals per tab**
- "+" button in terminal header to spawn additional PTY
- Terminal selector dropdown (Terminal 1, Terminal 2, etc.)
- Each terminal independent (own PTY, own shell)
- Close button per terminal (keeps at least one)
- Files: `components/Terminal/TerminalView.tsx`, `hooks/usePty.ts`, `stores/tabs.ts`

**Task 29: Split terminal view**
- Cmd+D splits terminal horizontally
- Each split is an independent PTY
- Allotment-based resizable divider
- Close split button
- Files: `components/Terminal/TerminalView.tsx`, `stores/tabs.ts`

**Task 30: Terminal find/search UI**
- Ctrl+F opens search bar overlay in terminal
- Uses xterm.js SearchAddon (already loaded)
- Next/Previous match navigation
- Match count display
- Close with Escape
- Files: `components/Terminal/TerminalView.tsx`

### Phase 9: Service Integration (3 tasks)

**Task 31: Supabase OAuth + project linking**
- Implement Supabase OAuth flow (similar to Vercel PKCE)
- Store token in electron-store
- Show connection status in ServiceIcons
- List projects, link to current repo
- Files: `oauth/supabase.ts`, `components/ServiceIcons/ServiceIcons.tsx`, `preload/index.ts`

**Task 32: Deploy status streaming**
- Stream Vercel build logs in real-time via polling or SSE
- Show in canvas panel as a "Deploy" tab (temporary, auto-closes on completion)
- Progress bar in StatusBar during deploy
- Files: `oauth/vercel.ts`, new `components/Canvas/DeployLog.tsx`

**Task 33: Environment variable editor**
- Settings panel section for `.env` management
- Read `.env` file, show key-value editor
- Add/edit/delete variables
- Sync with Vercel env vars (if connected)
- Files: new `components/Settings/EnvEditor.tsx`, new `services/env.ts`

### Phase 10: Advanced Canvas (5 tasks)

**Task 34: Auto component gallery**
- Scan `src/components/**/*.tsx` on project open
- Parse default exports, generate render HTML
- Auto-populate gallery with all discovered components
- Refresh on file change
- Files: new `services/component-scanner.ts`, `hooks/useMcpCommands.ts`, `stores/gallery.ts`

**Task 35: Accessibility audit tab**
- New canvas tab: "A11y"
- Inject axe-core into preview iframe
- Run audit on page load + after HMR
- Display issues list: severity, element, description, fix suggestion
- Click issue → highlight element in preview
- Files: new `components/Canvas/A11yAudit.tsx`, `inspector/overlay.ts`

**Task 36: CSS layout visualizer**
- Inspector hover shows flex/grid overlay
- Flex: direction arrows, justify/align indicators, gap visualization
- Grid: track lines, cell labels, gap visualization
- Margin/padding box model overlay
- Files: `inspector/overlay.ts`, `inspector/style-extractor.ts`

**Task 37: Performance profiling overlay**
- Inject PerformanceObserver into preview iframe
- Collect: LCP, FID, CLS, TTFB
- Show metrics badge in canvas header
- Color coded: green (good), yellow (needs improvement), red (poor)
- Files: new `components/Canvas/PerfMetrics.tsx`, `inspector/overlay.ts`

**Task 38: AI design feedback**
- "Get Feedback" button in canvas toolbar
- Captures screenshot, sends to Claude with design analysis prompt
- Claude responds with suggestions
- Display suggestions as annotated overlay on canvas
- Files: new `components/Canvas/DesignFeedback.tsx`, `mcp/tools.ts`

---

## Tech Stack for New Features

| Feature | Technology |
|---------|-----------|
| File explorer | Node.js `fs.readdir` recursive via IPC |
| Search | ripgrep (if available) or Node.js fallback |
| Template scaffolding | `npx create-*` via child_process |
| Framework detection | package.json parser |
| Token tracking | PTY output regex parsing |
| Visual regression | pixelmatch npm package |
| A11y audit | axe-core (injected into iframe) |
| Layout visualizer | DOM overlay (injected via inspector) |
| Performance metrics | PerformanceObserver API (in iframe) |
| Environment editor | dotenv parse/stringify |
| Deploy streaming | Vercel REST API polling |
| Multiple terminals | Array of PTY instances per tab |
| Split terminals | Allotment (already in project) |
| Terminal search | xterm SearchAddon (already loaded) |

---

## Success Criteria

### Plan 1 (Fixes) — Definition of Done
- [ ] Zero memory leaks: git instances, watchers, PTYs cleaned on tab close
- [ ] Dev server start/stop is race-condition-free
- [ ] Inline rendering works for components under 400x200px
- [ ] Tab state restored on app restart
- [ ] All `.catch(() => {})` replaced with proper error handling
- [ ] 4 new MCP tools reduce token usage by ~85%
- [ ] All existing tests pass (65+)
- [ ] Clean production build

### Plan 2 (Features) — Definition of Done
- [ ] New users can scaffold a project from templates in under 60 seconds
- [ ] Token usage visible in StatusBar at all times
- [ ] Canvas has 7+ responsive breakpoints (not just desktop/mobile)
- [ ] Inspector highlights persist until explicitly cleared
- [ ] Gallery supports delete, rename, duplicate, export
- [ ] One-click rollback from any checkpoint
- [ ] One-click deploy to Vercel
- [ ] 25+ Quick Actions available via Cmd+K
- [ ] Settings panel covers all configurable options
- [ ] File explorer shows project structure
- [ ] Project-wide search works via Cmd+Shift+F
- [ ] Multiple terminals per tab with split view
- [ ] Supabase OAuth functional
- [ ] Accessibility audit runs automatically on preview load
- [ ] All new features have test coverage
