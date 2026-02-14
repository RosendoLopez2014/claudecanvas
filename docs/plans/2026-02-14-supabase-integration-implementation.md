# Supabase Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the minimal Supabase integration to a full-featured integration matching Vercel/GitHub, with embedded OAuth, rich dropdown UI, and MCP tools for Claude Code.

**Architecture:** Rewrite `src/main/oauth/supabase.ts` to follow the Vercel pattern (WebContentsView + local HTTP callback). Add 8 MCP tools to `src/main/mcp/tools.ts` so Claude Code can query schema, run SQL, and manage Supabase resources. Expand the ServiceIcons dropdown with project management UI.

**Tech Stack:** Electron WebContentsView, Supabase Management API v1, MCP SDK (Zod schemas), Zustand, Tailwind CSS 4, Framer Motion

---

### Task 1: Update electron-store Schema

**Files:**
- Modify: `src/main/store.ts`

**Step 1: Add supabaseUser and supabaseAuth to SettingsSchema**

In `src/main/store.ts`, update the `SettingsSchema` interface to add:

```typescript
interface SettingsSchema {
  projectsDir: string
  recentProjects: Array<{
    name: string
    path: string
    framework?: string
    devCommand?: string
    devPort?: number
    lastOpened?: number
  }>
  theme: 'dark'
  onboardingComplete: boolean
  oauthTokens: {
    github?: string
    vercel?: string
    supabase?: string
  }
  githubUser?: { login: string; avatar_url: string }
  vercelUser?: { username: string; name: string | null; avatar: string | null }
  supabaseUser?: { id: string; name: string; email: string; avatar_url: string | null }
  supabaseAuth?: { orgId: string }
}
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add src/main/store.ts
git commit -m "feat(supabase): add supabaseUser and supabaseAuth to store schema"
```

---

### Task 2: Rewrite Supabase OAuth — Core Auth Flow

**Files:**
- Modify: `src/main/oauth/supabase.ts`

**Step 1: Rewrite the entire file**

Replace all contents of `src/main/oauth/supabase.ts` with the following. This follows the Vercel pattern exactly: WebContentsView + local HTTP callback server + CSRF state parameter.

```typescript
import { ipcMain, WebContentsView, BrowserWindow } from 'electron'
import { settingsStore } from '../store'
import http from 'http'
import crypto from 'crypto'

const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID || ''
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET || ''
const AUTH_URL = 'https://api.supabase.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.supabase.com/v1/oauth/token'
const REDIRECT_PORT = 38903
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`

let activeAuthView: WebContentsView | null = null
let pendingResolve: ((value: { token: string } | { error: string }) => void) | null = null
let callbackServer: http.Server | null = null

function cleanupAuthView(win: BrowserWindow): void {
  if (!activeAuthView) return
  try {
    win.contentView.removeChildView(activeAuthView)
    activeAuthView.webContents.close()
  } catch {
    // View may already be removed
  }
  activeAuthView = null
}

function cleanupServer(): void {
  if (callbackServer) {
    try { callbackServer.close() } catch {}
    callbackServer = null
  }
}

/** Build a Supabase Management API URL. */
function supabaseApi(path: string): string {
  return `https://api.supabase.com/v1${path}`
}

/** Fetch the authenticated user's profile. */
async function fetchSupabaseUser(
  token: string
): Promise<{ id: string; name: string; email: string; avatar_url: string | null } | null> {
  try {
    const res = await fetch(supabaseApi('/profile'), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) {
      console.error('[Supabase] fetchUser error:', res.status, await res.text())
      return null
    }
    const data = await res.json() as {
      id?: string
      primary_email?: string
      username?: string
      first_name?: string
      last_name?: string
      avatar_url?: string
    }
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || 'User'
    return {
      id: data.id || '',
      name,
      email: data.primary_email || '',
      avatar_url: data.avatar_url || null
    }
  } catch (err) {
    console.error('[Supabase] fetchUser exception:', err)
    return null
  }
}

/** Fetch the user's primary organization ID. */
async function fetchPrimaryOrgId(token: string): Promise<string | null> {
  try {
    const res = await fetch(supabaseApi('/organizations'), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return null
    const orgs = await res.json() as Array<{ id: string; name: string }>
    return orgs[0]?.id || null
  } catch {
    return null
  }
}

export function setupSupabaseOAuth(getWindow: () => BrowserWindow | null): void {
  // ─── Start OAuth flow ───
  ipcMain.handle(
    'oauth:supabase:start',
    async (
      _event,
      args: { bounds: { x: number; y: number; width: number; height: number } }
    ) => {
      const win = getWindow()
      if (!win) return { error: 'No window available' }

      if (activeAuthView) cleanupAuthView(win)
      cleanupServer()

      const state = crypto.randomBytes(16).toString('hex')

      return new Promise<{ token: string } | { error: string }>((resolve) => {
        pendingResolve = resolve

        const finish = (result: { token: string } | { error: string }) => {
          clearTimeout(timeout)
          cleanupAuthView(win)
          cleanupServer()
          if (pendingResolve) {
            pendingResolve(result)
            pendingResolve = null
          }
        }

        const timeout = setTimeout(() => {
          finish({ error: 'Timed out — try again' })
        }, 600000)

        const server = http.createServer(async (req, res) => {
          const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`)
          const code = url.searchParams.get('code')
          const returnedState = url.searchParams.get('state')

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>')
            finish({ error: 'Invalid callback — state mismatch or missing code' })
            return
          }

          try {
            const tokenRes = await fetch(TOKEN_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
              },
              body: JSON.stringify({
                grant_type: 'authorization_code',
                code,
                client_id: SUPABASE_CLIENT_ID,
                client_secret: SUPABASE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI
              })
            })

            const data = (await tokenRes.json()) as { access_token?: string; error?: string }

            if (data.access_token) {
              const accessToken = data.access_token

              // Store token
              const tokens = settingsStore.get('oauthTokens') || {}
              settingsStore.set('oauthTokens', { ...tokens, supabase: accessToken })

              // Fetch and store user profile
              const user = await fetchSupabaseUser(accessToken)
              if (user) {
                settingsStore.set('supabaseUser', user)
              }

              // Fetch and store primary org
              const orgId = await fetchPrimaryOrgId(accessToken)
              if (orgId) {
                settingsStore.set('supabaseAuth', { orgId })
              }

              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end('<html><body style="background:#000;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connected to Supabase!</h2><p style="opacity:0.5">You can close this tab.</p></div></body></html>')
              finish({ token: accessToken })
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html' })
              res.end('<html><body><h2>Authorization failed</h2></body></html>')
              finish({ error: data.error || 'Token exchange failed' })
            }
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Server error</h2></body></html>')
            finish({ error: `Token exchange failed: ${err}` })
          }
        })

        callbackServer = server

        server.listen(REDIRECT_PORT, '127.0.0.1', () => {
          const authUrl = new URL(AUTH_URL)
          authUrl.searchParams.set('client_id', SUPABASE_CLIENT_ID)
          authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
          authUrl.searchParams.set('response_type', 'code')
          authUrl.searchParams.set('state', state)

          const authView = new WebContentsView({
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false
            }
          })

          activeAuthView = authView

          const TAB_BAR_HEIGHT = 32
          authView.setBounds({
            x: Math.round(args.bounds.x),
            y: Math.round(args.bounds.y) + TAB_BAR_HEIGHT,
            width: Math.round(args.bounds.width),
            height: Math.round(args.bounds.height) - TAB_BAR_HEIGHT
          })

          win.contentView.addChildView(authView)

          // Escape to cancel
          authView.webContents.on('before-input-event', (_e, input) => {
            if (input.key === 'Escape' && input.type === 'keyDown') {
              finish({ error: 'Cancelled' })
            }
          })

          // Allow SSO popups
          authView.webContents.setWindowOpenHandler(({ url }) => {
            const allowedPopups = [
              'accounts.google.com',
              'appleid.apple.com',
              'github.com/login',
              'github.com/sessions'
            ]
            if (allowedPopups.some((d) => url.includes(d))) {
              return { action: 'allow' }
            }
            return { action: 'deny' }
          })

          authView.webContents.loadURL(authUrl.toString())
        })
      })
    }
  )

  // ─── Cancel ───
  ipcMain.handle('oauth:supabase:cancel', () => {
    const win = getWindow()
    if (win) cleanupAuthView(win)
    cleanupServer()
    if (pendingResolve) {
      pendingResolve({ error: 'Cancelled' })
      pendingResolve = null
    }
    return { cancelled: true }
  })

  // ─── Update bounds on resize ───
  ipcMain.on(
    'oauth:supabase:updateBounds',
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      if (activeAuthView) {
        const TAB_BAR_HEIGHT = 32
        activeAuthView.setBounds({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y) + TAB_BAR_HEIGHT,
          width: Math.round(bounds.width),
          height: Math.round(bounds.height) - TAB_BAR_HEIGHT
        })
      }
    }
  )

  // ─── Status ───
  ipcMain.handle('oauth:supabase:status', async () => {
    const tokens = settingsStore.get('oauthTokens') || {}

    let user = settingsStore.get('supabaseUser') as
      | { id: string; name: string; email: string; avatar_url: string | null }
      | undefined

    // Auto-fetch user profile if we have a token but no stored user
    if (tokens.supabase && !user) {
      const fetched = await fetchSupabaseUser(tokens.supabase)
      if (fetched) {
        settingsStore.set('supabaseUser', fetched)
        user = fetched
      }
    }

    return {
      connected: !!tokens.supabase,
      name: user?.name,
      email: user?.email,
      avatar_url: user?.avatar_url
    }
  })

  // ─── Logout ───
  ipcMain.handle('oauth:supabase:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.supabase
    settingsStore.set('oauthTokens', tokens)
    settingsStore.delete('supabaseUser')
    settingsStore.delete('supabaseAuth')
    const win = getWindow()
    if (win) cleanupAuthView(win)
  })
}
```

**Step 2: Update the registration call in `src/main/index.ts`**

Change line 70 from:
```typescript
setupSupabaseOAuth()
```
to:
```typescript
setupSupabaseOAuth(() => mainWindow)
```

**Step 3: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build. The `start` handler now requires `{ bounds }` arg.

**Step 4: Commit**

```bash
git add src/main/oauth/supabase.ts src/main/index.ts
git commit -m "feat(supabase): rewrite OAuth with WebContentsView and user profile"
```

---

### Task 3: Add Supabase API Handlers

**Files:**
- Modify: `src/main/oauth/supabase.ts` (append to `setupSupabaseOAuth`)

**Step 1: Add API handlers**

Add the following IPC handlers inside `setupSupabaseOAuth()`, after the `logout` handler (before the closing `}`):

```typescript
  // ─── List projects ───
  ipcMain.handle('oauth:supabase:listProjects', async (): Promise<
    Array<{ id: string; name: string; ref: string; region: string; status: string }> | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const res = await fetch(supabaseApi('/projects'), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return { error: `Supabase API error (${res.status})` }
      const projects = await res.json() as Array<{
        id: string
        name: string
        ref: string
        region: string
        status: string
      }>
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        ref: p.ref,
        region: p.region,
        status: p.status
      }))
    } catch (err) {
      return { error: `Failed to fetch projects: ${err}` }
    }
  })

  // ─── Project details ───
  ipcMain.handle('oauth:supabase:projectDetails', async (
    _event, projectRef: string
  ): Promise<
    { id: string; name: string; ref: string; region: string; status: string; dbHost: string } | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const res = await fetch(supabaseApi(`/projects/${projectRef}`), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return { error: `Supabase API error (${res.status})` }
      const p = await res.json() as {
        id: string; name: string; ref: string; region: string; status: string
        database?: { host: string }
      }
      return {
        id: p.id, name: p.name, ref: p.ref, region: p.region, status: p.status,
        dbHost: p.database?.host || `db.${p.ref}.supabase.co`
      }
    } catch (err) {
      return { error: `Failed to fetch project: ${err}` }
    }
  })

  // ─── List tables (via SQL) ───
  ipcMain.handle('oauth:supabase:listTables', async (
    _event, projectRef: string
  ): Promise<
    Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }> | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const sql = `
        SELECT
          t.table_schema as schema,
          t.table_name as name,
          json_agg(json_build_object(
            'name', c.column_name,
            'type', c.data_type,
            'nullable', c.is_nullable = 'YES'
          ) ORDER BY c.ordinal_position) as columns
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_schema, t.table_name
        ORDER BY t.table_schema, t.table_name
      `
      const res = await fetch(supabaseApi(`/projects/${projectRef}/database/query`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      })
      if (!res.ok) {
        const errBody = await res.text()
        return { error: `SQL error (${res.status}): ${errBody}` }
      }
      const rows = await res.json() as Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>
      return rows
    } catch (err) {
      return { error: `Failed to list tables: ${err}` }
    }
  })

  // ─── Run SQL ───
  ipcMain.handle('oauth:supabase:runSql', async (
    _event, projectRef: string, sql: string
  ): Promise<{ rows: unknown[]; rowCount: number } | { error: string }> => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const res = await fetch(supabaseApi(`/projects/${projectRef}/database/query`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      })
      if (!res.ok) {
        const errBody = await res.text()
        return { error: `SQL error (${res.status}): ${errBody}` }
      }
      const rows = await res.json() as unknown[]
      return { rows, rowCount: Array.isArray(rows) ? rows.length : 0 }
    } catch (err) {
      return { error: `Failed to execute SQL: ${err}` }
    }
  })

  // ─── List edge functions ───
  ipcMain.handle('oauth:supabase:listFunctions', async (
    _event, projectRef: string
  ): Promise<
    Array<{ id: string; name: string; status: string; created_at: string }> | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const res = await fetch(supabaseApi(`/projects/${projectRef}/functions`), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return { error: `Supabase API error (${res.status})` }
      const fns = await res.json() as Array<{
        id: string; name: string; status: string; created_at: string
      }>
      return fns.map((f) => ({
        id: f.id, name: f.name, status: f.status, created_at: f.created_at
      }))
    } catch (err) {
      return { error: `Failed to list functions: ${err}` }
    }
  })

  // ─── List storage buckets ───
  ipcMain.handle('oauth:supabase:listBuckets', async (
    _event, projectRef: string
  ): Promise<
    Array<{ id: string; name: string; public: boolean }> | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const res = await fetch(supabaseApi(`/projects/${projectRef}/storage/buckets`), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return { error: `Supabase API error (${res.status})` }
      const buckets = await res.json() as Array<{
        id: string; name: string; public: boolean
      }>
      return buckets.map((b) => ({ id: b.id, name: b.name, public: b.public }))
    } catch (err) {
      return { error: `Failed to list buckets: ${err}` }
    }
  })

  // ─── List RLS policies (via SQL) ───
  ipcMain.handle('oauth:supabase:listPolicies', async (
    _event, projectRef: string
  ): Promise<
    Array<{ table: string; name: string; command: string; definition: string }> | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const sql = `
        SELECT
          schemaname || '.' || tablename as table,
          policyname as name,
          cmd as command,
          qual as definition
        FROM pg_policies
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, tablename, policyname
      `
      const res = await fetch(supabaseApi(`/projects/${projectRef}/database/query`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      })
      if (!res.ok) {
        const errBody = await res.text()
        return { error: `SQL error (${res.status}): ${errBody}` }
      }
      return await res.json() as Array<{ table: string; name: string; command: string; definition: string }>
    } catch (err) {
      return { error: `Failed to list policies: ${err}` }
    }
  })

  // ─── Get connection info ───
  ipcMain.handle('oauth:supabase:getConnectionInfo', async (
    _event, projectRef: string
  ): Promise<
    { url: string; anonKey: string; serviceKey: string; dbUrl: string } | { error: string }
  > => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const token = tokens.supabase
    if (!token) return { error: 'Not connected to Supabase' }

    try {
      const res = await fetch(supabaseApi(`/projects/${projectRef}/api-keys`), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return { error: `Supabase API error (${res.status})` }
      const keys = await res.json() as Array<{ name: string; api_key: string }>
      const anonKey = keys.find((k) => k.name === 'anon')?.api_key || ''
      const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key || ''
      return {
        url: `https://${projectRef}.supabase.co`,
        anonKey,
        serviceKey,
        dbUrl: `postgresql://postgres:[YOUR-PASSWORD]@db.${projectRef}.supabase.co:5432/postgres`
      }
    } catch (err) {
      return { error: `Failed to get connection info: ${err}` }
    }
  })
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/oauth/supabase.ts
git commit -m "feat(supabase): add API handlers for projects, tables, functions, storage, RLS, SQL"
```

---

### Task 4: Inject SUPABASE_ACCESS_TOKEN into PTY

**Files:**
- Modify: `src/main/pty.ts:32-35`

**Step 1: Add token injection**

In `src/main/pty.ts`, find the token injection block (around line 32-34):

```typescript
        if (tokens.github) env.GH_TOKEN = tokens.github
        if (tokens.vercel) env.VERCEL_TOKEN = tokens.vercel
```

Add after the vercel line:
```typescript
        if (tokens.supabase) env.SUPABASE_ACCESS_TOKEN = tokens.supabase
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/pty.ts
git commit -m "feat(supabase): inject SUPABASE_ACCESS_TOKEN into PTY environment"
```

---

### Task 5: Expand Preload Bridge

**Files:**
- Modify: `src/preload/index.ts:193-197`

**Step 1: Replace the minimal supabase bridge**

Replace the existing supabase section (lines 193-197):

```typescript
    supabase: {
      start: () => ipcRenderer.invoke('oauth:supabase:start'),
      status: () => ipcRenderer.invoke('oauth:supabase:status'),
      logout: () => ipcRenderer.invoke('oauth:supabase:logout')
    }
```

With the full bridge:

```typescript
    supabase: {
      start: (args: {
        bounds: { x: number; y: number; width: number; height: number }
      }) => ipcRenderer.invoke('oauth:supabase:start', args) as Promise<
        { token: string } | { error: string }
      >,
      cancel: () => ipcRenderer.invoke('oauth:supabase:cancel'),
      updateBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
        ipcRenderer.send('oauth:supabase:updateBounds', bounds),
      status: () =>
        ipcRenderer.invoke('oauth:supabase:status') as Promise<{
          connected: boolean
          name?: string
          email?: string
          avatar_url?: string | null
        }>,
      logout: () => ipcRenderer.invoke('oauth:supabase:logout'),
      listProjects: () =>
        ipcRenderer.invoke('oauth:supabase:listProjects') as Promise<
          Array<{ id: string; name: string; ref: string; region: string; status: string }> | { error: string }
        >,
      projectDetails: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:projectDetails', projectRef) as Promise<
          { id: string; name: string; ref: string; region: string; status: string; dbHost: string } | { error: string }
        >,
      listTables: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listTables', projectRef) as Promise<
          Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }> | { error: string }
        >,
      runSql: (projectRef: string, sql: string) =>
        ipcRenderer.invoke('oauth:supabase:runSql', projectRef, sql) as Promise<
          { rows: unknown[]; rowCount: number } | { error: string }
        >,
      listFunctions: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listFunctions', projectRef) as Promise<
          Array<{ id: string; name: string; status: string; created_at: string }> | { error: string }
        >,
      listBuckets: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listBuckets', projectRef) as Promise<
          Array<{ id: string; name: string; public: boolean }> | { error: string }
        >,
      listPolicies: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listPolicies', projectRef) as Promise<
          Array<{ table: string; name: string; command: string; definition: string }> | { error: string }
        >,
      getConnectionInfo: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:getConnectionInfo', projectRef) as Promise<
          { url: string; anonKey: string; serviceKey: string; dbUrl: string } | { error: string }
        >
    }
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass. The `api-bridge.test.ts` mock may need updating if it references `oauth.supabase.start` — check and update mock if needed to include `args` parameter.

**Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(supabase): expand preload bridge with all API methods"
```

---

### Task 6: Add MCP Tools for Claude Code

**Files:**
- Modify: `src/main/mcp/tools.ts`

**Step 1: Add Supabase tools**

At the end of the `registerMcpTools` function, before the closing `}`, add:

```typescript
  // ─── Supabase Tools ───

  server.tool(
    'supabase_list_projects',
    'List all Supabase projects in the connected organization. Returns project names, refs, regions, and statuses.',
    {},
    async () => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase. Ask the user to connect via the Supabase icon in the top-right.' }] }
      }

      try {
        const res = await fetch('https://api.supabase.com/v1/projects', {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `Supabase API error (${res.status})` }] }
        const projects = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_list_tables',
    'List all tables and their columns in the linked Supabase project database. Useful for understanding the schema before writing migrations or queries.',
    {
      projectRef: z.string().optional().describe('Supabase project ref (e.g., "abcdefghijkl"). Auto-detected from supabase/config.toml if omitted.')
    },
    async ({ projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found. Pass projectRef or ensure supabase/config.toml exists.' }] }

      const sql = `
        SELECT t.table_schema as schema, t.table_name as name,
          json_agg(json_build_object('name', c.column_name, 'type', c.data_type, 'nullable', c.is_nullable = 'YES') ORDER BY c.ordinal_position) as columns
        FROM information_schema.tables t
        JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_schema, t.table_name ORDER BY t.table_schema, t.table_name
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error (${res.status}): ${await res.text()}` }] }
        const rows = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_run_sql',
    'Execute a SQL query against the Supabase project database. Use for migrations (CREATE TABLE, ALTER TABLE), data queries (SELECT), inserts, updates, and RLS policy management. Returns query results as JSON.',
    {
      sql: z.string().describe('SQL query to execute'),
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ sql, projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error (${res.status}): ${await res.text()}` }] }
        const rows = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_get_schema',
    'Get the full database schema as DDL (CREATE TABLE statements). Useful before writing migrations to understand current state.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      const sql = `
        SELECT
          'CREATE TABLE ' || schemaname || '.' || tablename || ' (' ||
          string_agg(
            column_name || ' ' || data_type ||
            CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END ||
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
            ', ' ORDER BY ordinal_position
          ) || ');' as ddl
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        GROUP BY schemaname, tablename
        ORDER BY schemaname, tablename
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error: ${await res.text()}` }] }
        const rows = await res.json() as Array<{ ddl: string }>
        return { content: [{ type: 'text', text: rows.map((r) => r.ddl).join('\n\n') }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_list_functions',
    'List all Edge Functions deployed to the Supabase project.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const fns = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(fns, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_list_buckets',
    'List all storage buckets in the Supabase project.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/storage/buckets`, {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const buckets = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(buckets, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_get_connection_info',
    'Get the Supabase project connection details: API URL, anon key, service role key, and database URL.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const keys = await res.json() as Array<{ name: string; api_key: string }>
        const info = {
          url: `https://${ref}.supabase.co`,
          anonKey: keys.find((k) => k.name === 'anon')?.api_key || '',
          serviceKey: keys.find((k) => k.name === 'service_role')?.api_key || '',
          dbUrl: `postgresql://postgres:[YOUR-PASSWORD]@db.${ref}.supabase.co:5432/postgres`
        }
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_get_rls_policies',
    'List all Row Level Security (RLS) policies across all tables. Shows policy name, command (SELECT/INSERT/UPDATE/DELETE), and the policy definition.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      const sql = `
        SELECT schemaname || '.' || tablename as table, policyname as name, cmd as command, qual as definition
        FROM pg_policies WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, tablename, policyname
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error: ${await res.text()}` }] }
        const rows = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )
```

**Step 2: Add the `detectProjectRef` helper**

At the top of `tools.ts`, after the imports, add:

```typescript
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Auto-detect Supabase project ref from supabase/config.toml */
async function detectProjectRef(projectPath: string): Promise<string | null> {
  try {
    const configPath = join(projectPath, 'supabase', 'config.toml')
    const content = await readFile(configPath, 'utf-8')
    const match = content.match(/project_id\s*=\s*"([^"]+)"/)
    return match?.[1] || null
  } catch {
    return null
  }
}
```

**Step 3: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/mcp/tools.ts
git commit -m "feat(supabase): add 8 MCP tools for Claude Code integration"
```

---

### Task 7: Auto-Approve MCP Tools and Add CLAUDE.md Instructions

**Files:**
- Modify: `src/main/mcp/config-writer.ts`

**Step 1: Add Supabase tools to the allowedTools array**

In `writeToolPermissions()`, find the `allowedTools` array (around line 203) and add the Supabase tools after the canvas tools:

```typescript
    // Supabase MCP tools
    'mcp__claude-canvas__supabase_list_projects',
    'mcp__claude-canvas__supabase_list_tables',
    'mcp__claude-canvas__supabase_run_sql',
    'mcp__claude-canvas__supabase_get_schema',
    'mcp__claude-canvas__supabase_list_functions',
    'mcp__claude-canvas__supabase_list_buckets',
    'mcp__claude-canvas__supabase_get_connection_info',
    'mcp__claude-canvas__supabase_get_rls_policies',
```

**Step 2: Add Supabase instructions to CLAUDE.md**

In the `CANVAS_CLAUDE_MD` array (around line 8), add after the `canvas_get_screenshot` line (around line 33):

```typescript
  '',
  '## Supabase Tools',
  '',
  'If the project is connected to Supabase (check the Supabase icon in the top-right):',
  '',
  '- `supabase_list_tables` — See current database schema (tables + columns)',
  '- `supabase_run_sql` — Execute SQL (CREATE TABLE, ALTER, INSERT, SELECT, RLS policies)',
  '- `supabase_get_schema` — Full DDL dump of all tables',
  '- `supabase_get_rls_policies` — List all RLS policies',
  '- `supabase_list_functions` — List Edge Functions',
  '- `supabase_list_buckets` — List storage buckets',
  '- `supabase_get_connection_info` — Get API URL, keys, and database URL',
  '- `supabase_list_projects` — List all projects',
  '',
  '### Migration Workflow',
  '',
  '1. Call `supabase_list_tables` to understand current schema',
  '2. Write migration SQL file to `supabase/migrations/YYYYMMDDHHMMSS_description.sql`',
  '3. Call `supabase_run_sql` with the migration SQL to apply it',
  '4. Call `supabase_list_tables` to verify the change',
  '5. Call `canvas_checkpoint` with a description of the migration',
```

**Step 3: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/mcp/config-writer.ts
git commit -m "feat(supabase): auto-approve MCP tools and add CLAUDE.md instructions"
```

---

### Task 8: Update ServiceIcons — Supabase Dropdown UI

**Files:**
- Modify: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`

This is the largest task. The Supabase dropdown needs to match the Vercel dropdown pattern: user header, linked project, collapsible sections for tables/functions/storage/RLS.

**Step 1: Add Supabase state variables**

Find the state declarations section (around line 209-242) and add:

```typescript
  const [supabaseUser, setSupabaseUser] = useState<{ name: string; email: string; avatar_url: string | null } | null>(null)
  const [supabaseProjects, setSupabaseProjects] = useState<Array<{ id: string; name: string; ref: string; region: string; status: string }>>([])
  const [linkedSupabaseProject, setLinkedSupabaseProject] = useState<{ id: string; name: string; ref: string; region: string; status: string } | null>(null)
  const [loadingSupabaseProject, setLoadingSupabaseProject] = useState(false)
  const [supabaseTables, setSupabaseTables] = useState<Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>>([])
  const [supabaseFunctions, setSupabaseFunctions] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [supabaseBuckets, setSupabaseBuckets] = useState<Array<{ id: string; name: string; public: boolean }>>([])
  const [supabasePolicies, setSupabasePolicies] = useState<Array<{ table: string; name: string; command: string }>>([])
  const [showSupabaseTables, setShowSupabaseTables] = useState(false)
  const [showSupabaseFunctions, setShowSupabaseFunctions] = useState(false)
  const [showSupabaseBuckets, setShowSupabaseBuckets] = useState(false)
  const [showSupabasePolicies, setShowSupabasePolicies] = useState(false)
  const [supabaseConnectionInfo, setSupabaseConnectionInfo] = useState<{ url: string; anonKey: string; dbUrl: string } | null>(null)
  const [showSupabaseProjects, setShowSupabaseProjects] = useState(false)
  const [supabaseProjectSearch, setSupabaseProjectSearch] = useState('')
```

**Step 2: Update the status initialization**

In the `useEffect` that fetches initial status (around line 283-302), update the supabase handling:

```typescript
      window.api.oauth.supabase.status()
    ]).then(([gh, vc, sb]) => {
      const ghData = gh as { connected: boolean; login?: string; avatar_url?: string }
      const sbData = sb as { connected: boolean; name?: string; email?: string; avatar_url?: string | null }
      setStatus({
        github: ghData.connected,
        vercel: vc.connected,
        supabase: sbData.connected
      })
      // ... existing github/vercel user setting ...
      if (sbData.connected && sbData.name) {
        setSupabaseUser({ name: sbData.name, email: sbData.email || '', avatar_url: sbData.avatar_url || null })
      }
    })
```

**Step 3: Add Supabase resize handler**

After the existing Vercel resize `useEffect` (around line 327-336), add:

```typescript
  useEffect(() => {
    if (connecting !== 'supabase') return
    const onResize = () => {
      const bounds = getCanvasBounds()
      if (bounds) window.api.oauth.supabase.updateBounds(bounds)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [connecting])
```

**Step 4: Add connectSupabase handler**

Add a connect handler following the Vercel pattern:

```typescript
  const connectSupabase = useCallback(async () => {
    setDropdownOpen(null)
    setConnecting('supabase')

    useWorkspaceStore.getState().openCanvas()
    await new Promise((r) => setTimeout(r, 100))

    const bounds = getCanvasBounds()
    if (!bounds) {
      setConnecting(null)
      useToastStore.getState().addToast('Open the canvas panel first', 'error')
      return
    }

    const result = (await window.api.oauth.supabase.start({ bounds })) as
      | { token: string }
      | { error: string }

    setConnecting(null)

    if ('token' in result) {
      setStatus((prev) => ({ ...prev, supabase: true }))
      const statusData = await window.api.oauth.supabase.status()
      if (statusData.name) {
        setSupabaseUser({ name: statusData.name, email: statusData.email || '', avatar_url: statusData.avatar_url || null })
      }
      useToastStore.getState().addToast('Connected to Supabase!', 'success')
    } else if (result.error !== 'Cancelled') {
      useToastStore.getState().addToast(`Supabase: ${result.error}`, 'error')
    }
  }, [])

  const handleCancelSupabase = useCallback(() => {
    setConnecting(null)
    window.api.oauth.supabase.cancel()
  }, [])
```

**Step 5: Add fetchLinkedSupabaseProject**

Add project detection and data fetching:

```typescript
  const fetchLinkedSupabaseProject = useCallback(async () => {
    if (!currentProject?.path || !status.supabase) return
    setLoadingSupabaseProject(true)

    // Try to detect project ref from supabase/config.toml
    const projects = await window.api.oauth.supabase.listProjects()
    if ('error' in projects) {
      setLoadingSupabaseProject(false)
      return
    }

    // Match by folder name
    const folderName = currentProject.path.split('/').pop()?.toLowerCase()
    const linked = projects.find((p) => p.name.toLowerCase() === folderName)

    if (linked) {
      setLinkedSupabaseProject(linked)
      // Fetch tables, functions, buckets, policies in parallel
      const [tables, fns, buckets, policies, connInfo] = await Promise.all([
        window.api.oauth.supabase.listTables(linked.ref),
        window.api.oauth.supabase.listFunctions(linked.ref),
        window.api.oauth.supabase.listBuckets(linked.ref),
        window.api.oauth.supabase.listPolicies(linked.ref),
        window.api.oauth.supabase.getConnectionInfo(linked.ref)
      ])
      if (Array.isArray(tables)) setSupabaseTables(tables)
      if (Array.isArray(fns)) setSupabaseFunctions(fns)
      if (Array.isArray(buckets)) setSupabaseBuckets(buckets)
      if (Array.isArray(policies)) setSupabasePolicies(policies)
      if (!('error' in connInfo)) setSupabaseConnectionInfo(connInfo)
    } else {
      setSupabaseProjects(projects)
      setShowSupabaseProjects(true)
    }

    setLoadingSupabaseProject(false)
  }, [currentProject?.path, status.supabase])
```

**Step 6: Update the `connectService` and `disconnectService` functions**

In the `connectService` function, update the supabase case to use the new `connectSupabase`:

Find where `connectService('supabase')` is handled and replace with `connectSupabase()`.

In the `disconnectService` function, add cleanup:

```typescript
if (service === 'supabase') {
  setSupabaseUser(null)
  setLinkedSupabaseProject(null)
  setSupabaseTables([])
  setSupabaseFunctions([])
  setSupabaseBuckets([])
  setSupabasePolicies([])
  setSupabaseConnectionInfo(null)
}
```

**Step 7: Replace the Supabase dropdown JSX**

Find the existing minimal Supabase dropdown (around line 1169-1218) and replace with the full dropdown. The dropdown should follow the same structure as the Vercel dropdown: user header, linked project with status, collapsible sections.

This JSX is large — refer to the existing Vercel dropdown pattern (lines 875-1166) for exact styling conventions. Key sections:

1. **Header:** User avatar (or Database icon fallback) + name + email
2. **Loading state:** Spinner while fetching linked project
3. **Linked project:** Name, region, status dot (green=active), connection string with copy button
4. **Tables section:** Collapsible, shows `schema.table_name` with column count
5. **Edge Functions:** Collapsible, function names with status
6. **Storage Buckets:** Collapsible, bucket names with public/private badge
7. **RLS Policies:** Collapsible, count per table
8. **Open Dashboard button:** Opens `https://supabase.com/dashboard/project/{ref}` via `window.open`
9. **Disconnect button**

**Step 8: Trigger data fetch when Supabase dropdown opens**

In the dropdown open handler for supabase, call `fetchLinkedSupabaseProject()`:

```typescript
if (service === 'supabase' && status.supabase && !linkedSupabaseProject) {
  fetchLinkedSupabaseProject()
}
```

**Step 9: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 10: Commit**

```bash
git add src/renderer/components/ServiceIcons/ServiceIcons.tsx
git commit -m "feat(supabase): full ServiceIcons dropdown with projects, tables, functions, storage, RLS"
```

---

### Task 9: Expose Supabase State in MCP State Exposer

**Files:**
- Modify: `src/renderer/hooks/useMcpStateExposer.ts`

**Step 1: Add Supabase state to window.__canvasState**

Update the hook to include Supabase connection status. Import what's needed and add to the state object:

```typescript
import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'

export function useMcpStateExposer() {
  const { activeTab, previewUrl, inspectorActive, selectedElements } = useCanvasStore()
  const { mode } = useWorkspaceStore()
  const { isDevServerRunning, currentProject } = useProjectStore()

  useEffect(() => {
    // Fetch Supabase status asynchronously
    let supabaseConnected = false
    window.api.oauth.supabase.status().then((s) => {
      supabaseConnected = s.connected
      updateState()
    }).catch(() => {})

    function updateState() {
      ;(window as any).__canvasState = {
        activeTab,
        previewUrl,
        inspectorActive,
        workspaceMode: mode,
        devServerRunning: isDevServerRunning,
        projectName: currentProject?.name || null,
        projectPath: currentProject?.path || null,
        supabaseConnected
      }
    }

    updateState()
  }, [activeTab, previewUrl, inspectorActive, mode, isDevServerRunning, currentProject])

  useEffect(() => {
    ;(window as any).__inspectorContext = selectedElements.length > 0
      ? {
          selected: true,
          count: selectedElements.length,
          elements: selectedElements,
          ...selectedElements[0]
        }
      : { selected: false, count: 0, elements: [] }
  }, [selectedElements])
}
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/renderer/hooks/useMcpStateExposer.ts
git commit -m "feat(supabase): expose Supabase connection state via MCP state exposer"
```

---

### Task 10: Update Tests

**Files:**
- Modify: `src/renderer/__tests__/api-bridge.test.ts`
- Modify: `src/renderer/__tests__/stores.test.ts`

**Step 1: Update API bridge mocks**

In the test setup or mock file, update the `oauth.supabase` mock to match the new API surface:

```typescript
supabase: {
  start: vi.fn().mockResolvedValue({ token: 'sb-test-token' }),
  cancel: vi.fn().mockResolvedValue({ cancelled: true }),
  updateBounds: vi.fn(),
  status: vi.fn().mockResolvedValue({ connected: false }),
  logout: vi.fn().mockResolvedValue(undefined),
  listProjects: vi.fn().mockResolvedValue([]),
  projectDetails: vi.fn().mockResolvedValue({ error: 'Not connected' }),
  listTables: vi.fn().mockResolvedValue([]),
  runSql: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  listFunctions: vi.fn().mockResolvedValue([]),
  listBuckets: vi.fn().mockResolvedValue([]),
  listPolicies: vi.fn().mockResolvedValue([]),
  getConnectionInfo: vi.fn().mockResolvedValue({ error: 'Not connected' })
}
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/renderer/__tests__/api-bridge.test.ts src/renderer/__tests__/stores.test.ts
git commit -m "test(supabase): update mocks for expanded Supabase API surface"
```

---

### Task 11: End-to-End Build Verification

**Step 1: Run full build**

Run: `npx electron-vite build`
Expected: Clean build, no errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Manual smoke test checklist**

Run: `npm run dev`

Verify:
1. Supabase icon shows in ServiceIcons (top-right, Database icon)
2. Click icon → dropdown opens with "Connect" button
3. Click Connect → canvas opens, WebContentsView shows Supabase OAuth page
4. Press Escape → auth cancels cleanly
5. If connected: dropdown shows user email, linked project (if detected)
6. If connected: tables, functions, storage, RLS sections appear (collapsible)
7. Connection string has a working copy button
8. "Open Dashboard" opens external browser
9. Disconnect removes all state
10. In terminal: `echo $SUPABASE_ACCESS_TOKEN` shows the token
11. Claude Code can call `supabase_list_tables` and get results

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(supabase): complete integration with OAuth, UI, MCP tools, and CLI token injection"
```
