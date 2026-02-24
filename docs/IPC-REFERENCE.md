# IPC Reference

Complete reference for the preload bridge API defined in `src/preload/index.ts`. All renderer↔main communication goes through `window.api.*`.

## Conventions

- **`invoke`** = request/response (async, returns a Promise)
- **`send`** = fire-and-forget (sync, no return value)
- **`on*`** = event listener (returns unsubscribe function)

All `on*` listeners are wrapped in try/catch — a thrown callback never crashes the renderer.

---

## Window

Controls the frameless window.

| Method | Type | Description |
|---|---|---|
| `window.minimize()` | send | Minimize window |
| `window.maximize()` | send | Toggle maximize/unmaximize |
| `window.close()` | send | Close window |
| `window.isMaximized()` | invoke → `boolean` | Check maximized state |
| `window.getBounds()` | invoke → `{x, y, width, height}` | Get window bounds |
| `window.setSize(w, h, animate?)` | invoke | Resize and center window |

---

## PTY

Terminal process management via node-pty.

| Method | Type | Description |
|---|---|---|
| `pty.spawn(shell?, cwd?)` | invoke → `string` | Spawn PTY, returns UUID-based ID |
| `pty.write(id, data)` | send | Write data to PTY stdin |
| `pty.resize(id, cols, rows)` | send | Resize PTY dimensions |
| `pty.kill(id)` | send | Kill PTY (SIGTERM → SIGKILL escalation) |
| `pty.setCwd(id, cwd)` | send | Change PTY working directory |
| `pty.onData(id, cb)` | on → `(data: string)` | PTY stdout data (batched) |
| `pty.onExit(id, cb)` | on → `(exitCode: number)` | PTY process exit |

---

## Settings

Persistent settings via electron-store.

| Method | Type | Description |
|---|---|---|
| `settings.get(key)` | invoke → `any` | Get setting value |
| `settings.set(key, value)` | invoke | Set setting value |
| `settings.getAll()` | invoke → `object` | Get all settings |

---

## Dialog

Native OS dialogs.

| Method | Type | Description |
|---|---|---|
| `dialog.selectDirectory()` | invoke → `string \| null` | Open directory picker |

---

## Framework Detection

| Method | Type | Description |
|---|---|---|
| `framework.detect(projectPath)` | invoke | Detect project framework |

---

## Templates

Project scaffolding.

| Method | Type | Description |
|---|---|---|
| `template.list()` | invoke → `Template[]` | List available templates |
| `template.scaffold(opts)` | invoke | Create project from template |
| `template.onProgress(cb)` | on → `{text: string}` | Scaffold progress updates |

**scaffold opts:** `{ templateId: string, projectName: string, parentDir: string }`

---

## Search

Full-text search across project files.

| Method | Type | Description |
|---|---|---|
| `search.project(rootPath, query, caseSensitive?)` | invoke → `SearchResult[]` | Search project files |

**SearchResult:** `{ filePath, relativePath, lineNumber, lineContent }`

---

## File System

File watching and directory tree.

| Method | Type | Description |
|---|---|---|
| `fs.tree(rootPath, depth?)` | invoke → `TreeNode[]` | Get directory tree |
| `fs.watch(path)` | invoke → `boolean` | Start watching project path |
| `fs.unwatch(path?)` | invoke | Stop watching (omit path = stop all) |
| `fs.onChange(cb)` | on → `{projectPath, path}` | File changed |
| `fs.onAdd(cb)` | on → `{projectPath, path}` | File added |
| `fs.onUnlink(cb)` | on → `{projectPath, path}` | File deleted |

---

## Visual Diff

Pixel-level image comparison.

| Method | Type | Description |
|---|---|---|
| `visualDiff.compare(imageA, imageB)` | invoke → `{diffPercent} \| null` | Compare two images |

---

## Screenshot

Capture viewport regions and checkpoint screenshots.

| Method | Type | Description |
|---|---|---|
| `screenshot.capture(rect)` | invoke → `string` | Capture viewport region (base64) |
| `screenshot.captureCheckpoint(hash, projectPath)` | invoke → `string \| null` | Capture for git checkpoint |
| `screenshot.loadCheckpoint(hash, projectPath)` | invoke → `string \| null` | Load saved checkpoint screenshot |

**rect:** `{ x: number, y: number, width: number, height: number }`

---

## Inspector

Canvas element inspector overlay.

| Method | Type | Description |
|---|---|---|
| `inspector.inject()` | invoke → `{success, error?}` | Inject inspector overlay into iframe |
| `inspector.findFile(componentName, projectPath)` | invoke → `string \| null` | Find source file for component |

---

## Render Router

Evaluate inline vs canvas rendering.

| Method | Type | Description |
|---|---|---|
| `render.evaluate(html, css?)` | invoke | Evaluate component dimensions |

---

## Git

Git operations via simple-git.

| Method | Type | Description |
|---|---|---|
| `git.init(cwd)` | invoke | Initialize git repo |
| `git.status(projectPath)` | invoke | Get git status |
| `git.branch(projectPath)` | invoke | Get branch info |
| `git.log(projectPath, maxCount?)` | invoke | Get commit log |
| `git.checkpoint(projectPath, message)` | invoke | Create checkpoint commit |
| `git.diff(projectPath, hash?)` | invoke | Get diff (working tree or vs hash) |
| `git.diffBetween(projectPath, from, to)` | invoke | Diff between two commits |
| `git.show(projectPath, hash, filePath)` | invoke | Show file at specific commit |
| `git.remoteUrl(projectPath)` | invoke → `string \| null` | Get remote URL |
| `git.getProjectInfo(cwd)` | invoke → `{remoteUrl, branch, error?}` | Get project git info |
| `git.setRemote(cwd, remoteUrl)` | invoke → `{ok} \| {error}` | Set remote URL |
| `git.fetch(projectPath)` | invoke → `{ahead, behind, error?}` | Fetch and compare |
| `git.pull(projectPath)` | invoke → `{success, conflicts?, error?}` | Pull from remote |
| `git.squashAndPush(projectPath, message)` | invoke → `{success, branch} \| {success: false, error, needsPull?}` | Squash checkpoints and push |
| `git.generateCommitMessage(projectPath)` | invoke → `string` | Auto-generate commit message |
| `git.createPr(projectPath, opts)` | invoke → `{url, number} \| {error}` | Create GitHub PR |
| `git.cleanup(projectPath)` | invoke | Clean up worktree artifacts |
| `git.rollback(projectPath, hash)` | invoke → `{success, error?}` | Rollback to checkpoint |
| `git.revertFile(projectPath, hash, filePath)` | invoke → `{success, error?}` | Revert single file to checkpoint |

**createPr opts:** `{ title: string, body: string, base: string }`

---

## OAuth — GitHub

GitHub OAuth via device flow.

| Method | Type | Description |
|---|---|---|
| `oauth.github.requestCode()` | invoke → `{user_code, device_code, interval, expires_in} \| {error}` | Start device flow |
| `oauth.github.start(args)` | invoke | Begin polling for token |
| `oauth.github.cancel()` | invoke | Cancel auth flow |
| `oauth.github.updateBounds(bounds)` | send | Update popup position |
| `oauth.github.status()` | invoke | Get connection status |
| `oauth.github.logout()` | invoke | Disconnect |
| `oauth.github.listRepos()` | invoke → `Repo[] \| {error}` | List user repos |
| `oauth.github.createRepo(opts)` | invoke → `{url, owner} \| {error}` | Create repo |
| `oauth.github.prStatus(repoFullName, branch)` | invoke → PR status | Check PR status for branch |

---

## OAuth — Vercel

Vercel OAuth via PKCE flow.

| Method | Type | Description |
|---|---|---|
| `oauth.vercel.start(args)` | invoke → `{token} \| {error}` | Start PKCE flow |
| `oauth.vercel.cancel()` | invoke | Cancel auth flow |
| `oauth.vercel.updateBounds(bounds)` | send | Update popup position |
| `oauth.vercel.status()` | invoke → `{connected, username?, name?, avatar?}` | Connection status |
| `oauth.vercel.logout()` | invoke | Disconnect |
| `oauth.vercel.listProjects()` | invoke → `Project[] \| {error}` | List Vercel projects |
| `oauth.vercel.deployments(projectId)` | invoke → `Deployment[] \| {error}` | List deployments |
| `oauth.vercel.buildLogs(deploymentId)` | invoke → `LogEntry[] \| {error}` | Get build logs |
| `oauth.vercel.linkedProject(args)` | invoke → linked status | Check if project is linked |
| `oauth.vercel.importProject(opts)` | invoke → `{id, name, productionUrl} \| {error}` | Import git repo to Vercel |
| `oauth.vercel.redeploy(deploymentId)` | invoke → `{id, url, state} \| {error}` | Trigger redeployment |

---

## OAuth — Supabase

Supabase OAuth via PKCE flow.

| Method | Type | Description |
|---|---|---|
| `oauth.supabase.start()` | invoke → `{token} \| {error}` | Start PKCE flow |
| `oauth.supabase.cancel()` | invoke | Cancel auth flow |
| `oauth.supabase.status()` | invoke → `{connected, name?, email?, avatar_url?}` | Connection status |
| `oauth.supabase.logout()` | invoke | Disconnect |
| `oauth.supabase.listProjects()` | invoke → `Project[] \| {error}` | List Supabase projects |
| `oauth.supabase.projectDetails(ref)` | invoke → project details | Get project details |
| `oauth.supabase.listTables(ref)` | invoke → `Table[] \| {error}` | List database tables |
| `oauth.supabase.runSql(ref, sql)` | invoke → `{rows, rowCount} \| {error}` | Execute SQL query |
| `oauth.supabase.listFunctions(ref)` | invoke → `Function[] \| {error}` | List edge functions |
| `oauth.supabase.listBuckets(ref)` | invoke → `Bucket[] \| {error}` | List storage buckets |
| `oauth.supabase.listPolicies(ref)` | invoke → `Policy[] \| {error}` | List RLS policies |
| `oauth.supabase.getConnectionInfo(ref)` | invoke → connection strings | Get connection info |
| `oauth.supabase.onExpired(cb)` | on | Token expired notification |

---

## Dev Server

Development server lifecycle management.

| Method | Type | Description |
|---|---|---|
| `dev.start(cwd, command?)` | invoke | Start dev server |
| `dev.stop(cwd?)` | invoke | Stop dev server |
| `dev.status(cwd)` | invoke → `{running, url}` | Check dev server status |
| `dev.clearCrashHistory(cwd)` | invoke | Reset crash loop counter |
| `dev.resolve(projectPath)` | invoke | Resolve dev command and port |
| `dev.setOverride(projectPath, command, port?)` | invoke | Override dev command |
| `dev.clearOverride(projectPath)` | invoke | Clear dev command override |
| `dev.getConfig(projectPath)` | invoke | Get dev server config |
| `dev.onOutput(cb)` | on → `{cwd, data}` | Dev server stdout |
| `dev.onExit(cb)` | on → `{cwd, code}` | Dev server exit |
| `dev.onStatus(cb)` | on → `{cwd?, stage, message, url?}` | Dev server status changes |

---

## MCP Bridge

Model Context Protocol bridge for Claude Code integration.

| Method | Type | Description |
|---|---|---|
| `mcp.projectOpened(projectPath)` | invoke → `{port}` | Start MCP server |
| `mcp.projectClosed()` | invoke | Stop MCP server |
| `mcp.gallerySelect(variantId)` | send | Select gallery variant |
| `mcp.onCanvasRender(cb)` | on → `{html, css?}` | Render HTML in canvas |
| `mcp.onStartPreview(cb)` | on → `{command?, cwd?}` | Start dev preview |
| `mcp.onStopPreview(cb)` | on | Stop dev preview |
| `mcp.onSetPreviewUrl(cb)` | on → `{url}` | Set preview URL |
| `mcp.onOpenTab(cb)` | on → `{tab}` | Switch canvas tab |
| `mcp.onAddToGallery(cb)` | on → variant data | Add gallery variant |
| `mcp.onDesignSession(cb)` | on → session data | Design session events |
| `mcp.onCheckpoint(cb)` | on → `{message}` | Create git checkpoint |
| `mcp.onUpdateVariant(cb)` | on → variant updates | Update gallery variant |
| `mcp.onNotify(cb)` | on → `{message, type}` | Show toast notification |

---

## Worktrees

Git worktree management for multi-branch workflows.

| Method | Type | Description |
|---|---|---|
| `worktree.list(projectPath)` | invoke → `Worktree[] \| {error}` | List worktrees |
| `worktree.create(opts)` | invoke → `{path, branch} \| {error}` | Create new worktree |
| `worktree.checkout(opts)` | invoke → `{path, branch} \| {error}` | Checkout existing branch |
| `worktree.remove(opts)` | invoke → `{ok} \| {error}` | Remove worktree |
| `worktree.branches(projectPath)` | invoke → `{current, branches} \| {error}` | List branches |
