# Upgrade Notes — Security & Reliability Audit (2026-02-16)

## Summary

Six commits addressing 30 audit findings across Critical/High/Medium severity.
All changes are backward-compatible and do not alter the user-facing UI.

## Milestone 0: Safety Rails (`8c6c35d`)

- **DEBUG flag** (`src/shared/constants.ts`): New `DEBUG` constant gated on
  `NODE_ENV !== 'production'`. Use it to guard noisy logs.
- **IPC error resilience** (`src/preload/index.ts`): All renderer IPC listeners
  now wrapped in try/catch — a thrown callback no longer crashes the renderer.
- **StatusBar try/catch** (`StatusBar.tsx`): `handlePull` and `handleDeploy`
  use try/catch/finally so the loading spinner always resets.

## Milestone 1: Critical Security (`a07196d`)

- **OAuth secrets moved to env vars**: `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`,
  `SUPABASE_CLIENT_ID`, `SUPABASE_CLIENT_SECRET` are now read from `process.env`.
  Copy `.env.example` to `.env` and fill in values. If unset, OAuth flows return
  a user-friendly error instead of crashing.
- **Inspector postMessage hardened**: All `postMessage` calls use
  `window.location.origin` (not `'*'`). Receiver handlers validate `e.source`.
  Re-injection cleans up old listeners.
- **shell:true removed** from `templates.ts` scaffold spawn — eliminates
  command injection risk.
- **Supabase token validation**: `access_token` and `refresh_token` are
  type-checked (`typeof === 'string'`) before use.
- **Debug file removed**: Vercel OAuth no longer writes `vercel-debug.json`.

## Milestone 2: Token Storage (`04c7429`)

- **Encrypted token storage**: New `src/main/services/secure-storage.ts` uses
  Electron's `safeStorage` API (OS keychain) to encrypt all OAuth tokens at
  rest. `electron-store` no longer contains plaintext tokens.
- **Automatic migration**: On first launch, existing plaintext tokens in
  `oauthTokens` are encrypted and moved to `encryptedTokens`. The plaintext
  entries are then wiped.
- **Graceful fallback**: If the OS keychain is unavailable (rare — always
  available on macOS/Windows), tokens fall back to plaintext with a console
  warning.
- **All token access unified**: GitHub, Vercel, Supabase OAuth modules, plus
  `git.ts`, `pty.ts`, and `mcp/tools.ts` all use `getSecureToken()` /
  `setSecureToken()` / `deleteSecureToken()`.
- **Bug fix**: Restored missing `fsp` import in `vercel.ts` (regression from M1
  that broke `.vercel/project.json` reading).

## Milestone 3: Resource Lifecycle (`1b065c9`)

- **PTY kill escalation**: `pty:kill` now sends SIGTERM, waits 5 seconds, then
  escalates to SIGKILL if the process hasn't exited. Prevents zombie processes
  and FD leaks. `killAllPtys()` also force-kills after 1 second on app shutdown.
- **MCP session TTL**: Sessions inactive for 30 minutes are automatically reaped.
  Every POST/GET/DELETE request updates `lastActivity`. A 5-minute interval
  scanner closes stale sessions.
- **Inspector listener cleanup**: All event listeners (mousemove, click,
  mouseleave, scroll, resize) and the MutationObserver are now stored as
  `window.__ci*` references and removed on re-injection. Previously, each HMR
  reload leaked orphaned listeners.
- **executeJavaScript validation**: Inspector overlay injection now validates the
  frame URL is `localhost` before executing — refuses non-localhost origins.

## Milestone 4: Renderer Correctness (`81d78f7`)

- **Centralized path validation**: New `src/main/validate.ts` exports
  `isValidPath()` — used by `git.ts`, `dev-server.ts`, and `watcher.ts` IPC
  handlers to reject non-absolute or empty paths.
- **Preview race fix**: `CanvasPanel.tsx` HMR recovery effect now uses a
  stale-closure guard. If the user switches tabs/projects before the async
  `dev.status()` response arrives, the stale update is discarded.

## Milestone 5: Medium Hardening (`ab41254`)

- **Crypto PTY IDs**: PTY identifiers now use `crypto.randomUUID()` instead of
  an incrementing counter. Non-guessable IDs prevent cross-tab PTY hijacking.
- **Git token sanitization**: `sanitizeGitError()` strips embedded
  `x-access-token:<TOKEN>@` from error messages before returning to the
  renderer or logging.
- **Git timeout**: `simpleGit` instances now have a 30-second block timeout.
  Hanging git operations (e.g., credential prompts on a missing token) no
  longer freeze the app indefinitely.
- **Watcher symlinks**: `followSymlinks: false` prevents chokidar from entering
  circular symlink loops that consume all available FDs.
- **Gallery error handling**: Gallery iframe has an `onError` handler with a
  fallback "Failed to render preview" message instead of a blank card.

---

## Migration Checklist

1. **Environment variables**: Copy `.env.example` to `.env` and set your OAuth
   credentials. Without them, Vercel/Supabase OAuth will show an error instead
   of crashing.
2. **Token migration**: Automatic. On first launch after upgrade, plaintext
   tokens migrate to encrypted storage. No user action required.
3. **No schema changes**: The electron-store schema gains `encryptedTokens`
   (auto-initialized to `{}`). The deprecated `oauthTokens` field remains for
   migration compatibility.

## Smoke-Test Checklist

- [ ] App launches without errors
- [ ] Terminal spawns and Claude Code CLI works
- [ ] GitHub OAuth: connect, create repo, push, PR status
- [ ] Vercel OAuth: connect, list projects, deploy log
- [ ] Supabase OAuth: connect, list projects, run SQL
- [ ] Inspector: click elements, highlights appear, context pastes to terminal
- [ ] Gallery: render a component, error cards show fallback
- [ ] Canvas: switch tabs, preview URL doesn't leak between tabs
- [ ] File watcher: edit a file, change notification fires
- [ ] Git: commit, push, pull — no token leaks in error messages
- [ ] Dev server: start/stop works, status recovers after HMR
- [ ] Quit app: no zombie PTY processes left running
