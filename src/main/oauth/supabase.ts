import { ipcMain, WebContentsView, BrowserWindow } from 'electron'
import { settingsStore } from '../store'
import { OAUTH_TIMEOUT_MS } from '../../shared/constants'
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

/** Fetch the authenticated user's profile from Supabase. */
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
    const data = (await res.json()) as {
      id: string
      primary_email: string
      first_name?: string
      last_name?: string
      avatar_url?: string
    }
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || 'Supabase User'
    return {
      id: data.id,
      name,
      email: data.primary_email,
      avatar_url: data.avatar_url || null
    }
  } catch (err) {
    console.error('[Supabase] fetchUser exception:', err)
    return null
  }
}

/** Detect the user's primary organization. */
async function fetchSupabaseOrg(token: string): Promise<string | null> {
  try {
    const res = await fetch(supabaseApi('/organizations'), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return null
    const orgs = (await res.json()) as Array<{ id: string; name: string }>
    return orgs.length > 0 ? orgs[0].id : null
  } catch {
    return null
  }
}

export function setupSupabaseOAuth(getWindow: () => BrowserWindow | null): void {
  // ── OAuth start: WebContentsView + local callback server ──────────────
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
        }, OAUTH_TIMEOUT_MS)

        // Local HTTP callback server
        const server = http.createServer(async (req, res) => {
          const url = new URL(req.url || '', 'http://localhost')
          console.log('[Supabase] Callback params:', Object.fromEntries(url.searchParams.entries()))
          const code = url.searchParams.get('code')
          const returnedState = url.searchParams.get('state')

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>')
            finish({ error: 'Invalid callback — state mismatch or missing code' })
            return
          }

          // Exchange code for access token (JSON body for Supabase)
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

            const data = (await tokenRes.json()) as Record<string, unknown>
            console.log('[Supabase] Token exchange response keys:', Object.keys(data))

            if (data.access_token) {
              const accessToken = data.access_token as string

              // Store token
              const tokens = settingsStore.get('oauthTokens') || {}
              settingsStore.set('oauthTokens', { ...tokens, supabase: accessToken })
              console.log('[Supabase] Connected')

              // Fetch and store user profile
              const user = await fetchSupabaseUser(accessToken)
              if (user) {
                settingsStore.set('supabaseUser', user)
                console.log('[Supabase] User:', user.email)
              }

              // Detect org
              const orgId = await fetchSupabaseOrg(accessToken)
              if (orgId) {
                settingsStore.set('supabaseAuth', { orgId })
                console.log('[Supabase] Org:', orgId)
              }

              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end('<html><body style="background:#000;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connected to Supabase!</h2><p style="opacity:0.5">You can close this tab.</p></div></body></html>')
              finish({ token: accessToken })
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html' })
              res.end('<html><body><h2>Authorization failed</h2></body></html>')
              const errMsg = (data.error_description as string)
                || (typeof data.error === 'object' && data.error !== null
                    ? (data.error as { message?: string }).message || JSON.stringify(data.error)
                    : String(data.error))
                || 'Token exchange failed'
              finish({ error: errMsg })
            }
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Server error</h2></body></html>')
            finish({ error: `Token exchange failed: ${err}` })
          }
        })

        callbackServer = server

        // Listen on fixed port, then open auth URL in WebContentsView
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

          // Allow SSO popups (Google, Apple, GitHub)
          authView.webContents.setWindowOpenHandler(({ url }) => {
            const allowedPopups = [
              'supabase.com/dashboard',
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

  // ── Cancel ────────────────────────────────────────────────────────────
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

  // ── Update bounds ─────────────────────────────────────────────────────
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

  // ── Status with user info (auto-fetches profile if missing) ───────────
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
      id: user?.id,
      name: user?.name,
      email: user?.email,
      avatar_url: user?.avatar_url
    }
  })

  // ── Logout ────────────────────────────────────────────────────────────
  ipcMain.handle('oauth:supabase:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.supabase
    settingsStore.set('oauthTokens', tokens)
    settingsStore.delete('supabaseUser')
    settingsStore.delete('supabaseAuth')
    const win = getWindow()
    if (win) cleanupAuthView(win)
  })

  // ════════════════════════════════════════════════════════════════════════
  // Supabase API Handlers
  // ════════════════════════════════════════════════════════════════════════

  // ── List projects ─────────────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:listProjects',
    async (): Promise<
      Array<{ id: string; name: string; region: string; status: string }> | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      try {
        const res = await fetch(supabaseApi('/projects'), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) {
          const errBody = await res.text()
          console.error('[Supabase] listProjects error:', res.status, errBody)
          return { error: `Supabase API error (${res.status})` }
        }
        const projects = (await res.json()) as Array<{
          id: string
          name: string
          region: string
          status: string
        }>
        console.log('[Supabase] Found', projects.length, 'projects')
        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          region: p.region,
          status: p.status
        }))
      } catch (err) {
        console.error('[Supabase] listProjects exception:', err)
        return { error: `Failed to fetch projects: ${err}` }
      }
    }
  )

  // ── Project details ───────────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:projectDetails',
    async (
      _event,
      ref: string
    ): Promise<
      {
        id: string
        name: string
        region: string
        status: string
        database: { host: string; version: string }
      } | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      try {
        const res = await fetch(supabaseApi(`/projects/${ref}`), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const data = (await res.json()) as {
          id: string
          name: string
          region: string
          status: string
          database?: { host: string; version: string }
        }
        return {
          id: data.id,
          name: data.name,
          region: data.region,
          status: data.status,
          database: data.database || { host: '', version: '' }
        }
      } catch (err) {
        return { error: `Failed to fetch project details: ${err}` }
      }
    }
  )

  // ── List tables (via SQL) ─────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:listTables',
    async (
      _event,
      ref: string
    ): Promise<
      Array<{ schema: string; name: string; row_count: number | null }> | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      const sql = `
        SELECT schemaname AS schema, tablename AS name,
               n_live_tup AS row_count
        FROM pg_stat_user_tables
        ORDER BY schemaname, tablename
      `.trim()

      try {
        const res = await fetch(supabaseApi(`/projects/${ref}/database/query`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const rows = (await res.json()) as Array<{
          schema: string
          name: string
          row_count: number | null
        }>
        return rows
      } catch (err) {
        return { error: `Failed to list tables: ${err}` }
      }
    }
  )

  // ── Run arbitrary SQL ─────────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:runSql',
    async (
      _event,
      args: { ref: string; sql: string }
    ): Promise<{ rows: unknown[] } | { error: string }> => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      try {
        const res = await fetch(supabaseApi(`/projects/${args.ref}/database/query`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: args.sql })
        })
        if (!res.ok) {
          const errBody = await res.text()
          console.error('[Supabase] runSql error:', res.status, errBody)
          return { error: `SQL error (${res.status}): ${errBody}` }
        }
        const rows = (await res.json()) as unknown[]
        return { rows }
      } catch (err) {
        return { error: `Failed to execute SQL: ${err}` }
      }
    }
  )

  // ── List edge functions ───────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:listFunctions',
    async (
      _event,
      ref: string
    ): Promise<
      Array<{ id: string; slug: string; name: string; status: string; created_at: string }> | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      try {
        const res = await fetch(supabaseApi(`/projects/${ref}/functions`), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const fns = (await res.json()) as Array<{
          id: string
          slug: string
          name: string
          status: string
          created_at: string
        }>
        return fns.map((f) => ({
          id: f.id,
          slug: f.slug,
          name: f.name,
          status: f.status,
          created_at: f.created_at
        }))
      } catch (err) {
        return { error: `Failed to list functions: ${err}` }
      }
    }
  )

  // ── List storage buckets ──────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:listBuckets',
    async (
      _event,
      ref: string
    ): Promise<
      Array<{ id: string; name: string; public: boolean; created_at: string }> | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      try {
        const res = await fetch(supabaseApi(`/projects/${ref}/storage/buckets`), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const buckets = (await res.json()) as Array<{
          id: string
          name: string
          public: boolean
          created_at: string
        }>
        return buckets.map((b) => ({
          id: b.id,
          name: b.name,
          public: b.public,
          created_at: b.created_at
        }))
      } catch (err) {
        return { error: `Failed to list buckets: ${err}` }
      }
    }
  )

  // ── List RLS policies (via SQL) ───────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:listPolicies',
    async (
      _event,
      ref: string
    ): Promise<
      Array<{
        schemaname: string
        tablename: string
        policyname: string
        permissive: string
        roles: string[]
        cmd: string
        qual: string | null
      }> | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      const sql = `
        SELECT schemaname, tablename, policyname, permissive,
               roles, cmd, qual::text
        FROM pg_policies
        ORDER BY schemaname, tablename, policyname
      `.trim()

      try {
        const res = await fetch(supabaseApi(`/projects/${ref}/database/query`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const rows = (await res.json()) as Array<{
          schemaname: string
          tablename: string
          policyname: string
          permissive: string
          roles: string[]
          cmd: string
          qual: string | null
        }>
        return rows
      } catch (err) {
        return { error: `Failed to list policies: ${err}` }
      }
    }
  )

  // ── Get connection info (API keys) ────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:getConnectionInfo',
    async (
      _event,
      ref: string
    ): Promise<
      {
        apiKeys: Array<{ name: string; api_key: string }>
        endpoint: string
      } | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.supabase
      if (!token) return { error: 'Not connected to Supabase' }

      try {
        const res = await fetch(supabaseApi(`/projects/${ref}/api-keys`), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const keys = (await res.json()) as Array<{ name: string; api_key: string }>
        return {
          apiKeys: keys,
          endpoint: `https://${ref}.supabase.co`
        }
      } catch (err) {
        return { error: `Failed to fetch connection info: ${err}` }
      }
    }
  )
}
