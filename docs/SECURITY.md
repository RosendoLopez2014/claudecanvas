# Security

Claude Canvas handles OAuth tokens, spawns shell processes, and injects scripts into iframes. This document covers the security model and hardening measures.

## Context Isolation

Electron's context isolation is **always enabled**. The renderer process has no direct access to Node.js APIs:

```typescript
// BrowserWindow config (src/main/index.ts)
webPreferences: {
  contextIsolation: true,   // REQUIRED: never disable
  nodeIntegration: false,   // REQUIRED: never enable
  sandbox: false,           // Disabled for preload IPC
  webviewTag: false,        // webview disabled — we use iframe
}
```

All communication between renderer and main goes through the **typed preload bridge** (`src/preload/index.ts`). This bridge exposes a limited, typed `window.api` object via `contextBridge.exposeInMainWorld()`.

### IPC Error Resilience

All IPC event listeners in the preload bridge are wrapped in try/catch:

```typescript
function onIpc<T>(channel: string, cb: (data: T) => void): () => void {
  const handler = (_: unknown, data: T) => {
    try { cb(data) }
    catch (err) { console.error(`[IPC] Error in ${channel} listener:`, err) }
  }
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
```

A thrown callback never crashes the renderer process.

## Token Storage

OAuth tokens are encrypted at rest using Electron's `safeStorage` API, which leverages the OS keychain:

| OS | Backend |
|---|---|
| macOS | Keychain Services |
| Windows | DPAPI (Data Protection API) |
| Linux | libsecret / gnome-keyring |

### How It Works

1. `setSecureToken(key, value)` encrypts the token with `safeStorage.encryptString()` and stores the base64-encoded ciphertext in `electron-store` under `encryptedTokens[key]`.
2. `getSecureToken(key)` reads the ciphertext, decodes from base64, and decrypts with `safeStorage.decryptString()`.
3. `deleteSecureToken(key)` removes the entry.

### Token Migration

On first launch after the security upgrade, `initSecureStorage()` automatically:

1. Reads any plaintext tokens from the deprecated `oauthTokens` field
2. Encrypts each token and stores in `encryptedTokens`
3. Wipes the plaintext `oauthTokens` entries

No user action required. If the OS keychain is unavailable (rare), tokens fall back to plaintext with a console warning.

### Compound Tokens

Supabase stores both `accessToken` and `refreshToken`. These are JSON-serialized before encryption:

```typescript
// Storage: JSON.stringify({ accessToken, refreshToken }) → encrypt → base64
// Retrieval: base64 → decrypt → JSON.parse → { accessToken, refreshToken }
```

### Token Injection

Service tokens are injected into PTY environments so CLI tools use Canvas-authenticated accounts:

- `GH_TOKEN` — GitHub token for `gh` CLI
- `VERCEL_TOKEN` — Vercel token for `vercel` CLI
- `SUPABASE_ACCESS_TOKEN` — Supabase token for `supabase` CLI

Tokens are read from encrypted storage at PTY spawn time, never cached in memory.

## OAuth Flows

### GitHub (Device Flow)

1. Request device code from GitHub API
2. User enters code at `github.com/login/device`
3. Poll for access token
4. Token encrypted and stored

### Vercel & Supabase (PKCE Flow)

1. Generate code verifier and challenge
2. Open OAuth popup window
3. Exchange authorization code for tokens
4. Tokens encrypted and stored

### Environment Variables

OAuth client credentials are loaded from environment variables, never hardcoded:

```
VERCEL_CLIENT_ID
VERCEL_CLIENT_SECRET
SUPABASE_CLIENT_ID
SUPABASE_CLIENT_SECRET
```

If unset, OAuth flows return a user-friendly error instead of crashing.

## PTY Security

### Shell Allow-List

Only known shell paths are accepted:

```typescript
const ALLOWED_SHELLS = new Set([
  '/bin/bash', '/bin/zsh', '/bin/sh', '/bin/fish',
  '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/fish',
  '/usr/local/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash', '/opt/homebrew/bin/zsh', '/opt/homebrew/bin/fish',
  'powershell.exe', 'cmd.exe', 'pwsh.exe'
])
```

### Non-Guessable IDs

PTY identifiers use `crypto.randomUUID()` instead of incrementing counters. This prevents cross-tab PTY hijacking where one tab could write to another tab's terminal by guessing the ID.

### Working Directory Validation

PTY spawn validates `cwd` is an absolute path that exists on disk before creating the process.

### Kill Escalation

When a PTY is killed:
1. Send `SIGTERM`
2. Wait 5 seconds
3. If still alive, send `SIGKILL`
4. After 2 more seconds, force-remove from tracking map

On app shutdown, all PTYs get SIGTERM followed by SIGKILL after 1 second.

## Inspector Sandboxing

### Frame URL Validation

Inspector overlay injection only targets `localhost` URLs. The main process validates the frame URL before calling `executeJavaScript`:

```typescript
// Reject non-localhost origins
if (!frameUrl.includes('localhost') && !frameUrl.includes('127.0.0.1')) {
  return { success: false, error: 'Inspector only works on localhost' }
}
```

### postMessage Hardening

All `postMessage` calls use `window.location.origin` as the target origin (never `'*'`). Receiver handlers validate `e.source` to prevent cross-origin message injection.

### Listener Cleanup

Inspector event listeners (mousemove, click, mouseleave, scroll, resize) and MutationObserver are stored as `window.__ci*` references and removed on re-injection. This prevents listener leaks during HMR reloads.

## Git Token Sanitization

Git error messages are sanitized before being returned to the renderer or logged:

```typescript
function sanitizeGitError(msg: string): string {
  return msg.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@')
}
```

This strips embedded tokens from URLs in error messages (e.g., `https://x-access-token:ghp_xxx@github.com/...`).

## File Watcher Safety

### Symlink Protection

Chokidar runs with `followSymlinks: false` to prevent circular symlink loops that could exhaust all available file descriptors.

### Directory Ignore

A function-based ignore (not glob) prevents chokidar from recursing into `node_modules`, `.git`, `dist`, and other heavy directories. This reduces FD usage from ~17K to ~75 for typical projects.

## Path Validation

All IPC handlers that accept file paths use `isValidPath()` from `src/main/validate.ts`:

```typescript
export function isValidPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && path.isAbsolute(p)
}
```

This rejects empty strings, relative paths, and non-string inputs.

## MCP Session TTL

MCP server sessions inactive for 30 minutes are automatically reaped. A 5-minute interval scanner checks `lastActivity` timestamps and closes stale sessions. This prevents resource leaks from abandoned Claude Code sessions.

## Template Scaffolding

Project scaffolding runs without `shell: true` to prevent command injection. Child processes are spawned with explicit `shell: false` (the default).

## Debug Mode

The `DEBUG` constant gates noisy console output. In production builds (`NODE_ENV === 'production'`), it evaluates to `false`, preventing verbose logging that could leak internal state.
