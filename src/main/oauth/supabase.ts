import { ipcMain, BrowserWindow } from 'electron'
import { settingsStore } from '../store'
import { OAUTH_TIMEOUT_MS } from '../../shared/constants'
import http from 'http'
import crypto from 'crypto'

/**
 * OAuth credentials — loaded from environment variables.
 * In development: set SUPABASE_CLIENT_ID / SUPABASE_CLIENT_SECRET in .env
 * In production: a backend gateway should handle the token exchange.
 */
const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID || ''
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET || ''
const AUTH_URL = 'https://api.supabase.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.supabase.com/v1/oauth/token'
const REDIRECT_PORT = 38903
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`

let getMainWindow: (() => BrowserWindow | null) | null = null
let authWindow: BrowserWindow | null = null
let pendingResolve: ((value: { token: string } | { error: string }) => void) | null = null
let callbackServer: http.Server | null = null

function cleanupAuthWindow(): void {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close()
  }
  authWindow = null
}

/** Generate PKCE code_verifier (43-128 URL-safe random chars) */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** Derive code_challenge from code_verifier using S256 */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
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

/** Get the stored Supabase access token, or null if not connected. */
function getSupabaseToken(): string | null {
  const tokens = settingsStore.get('oauthTokens') || {}
  const val = tokens.supabase
  if (!val) return null
  // New format: { accessToken, refreshToken }
  if (typeof val === 'object' && val.accessToken) return val.accessToken
  // Legacy format: plain string
  if (typeof val === 'string') return val
  return null
}

/** Get the stored refresh token, or null. */
function getSupabaseRefreshToken(): string | null {
  const tokens = settingsStore.get('oauthTokens') || {}
  const val = tokens.supabase
  if (typeof val === 'object' && val.refreshToken) return val.refreshToken
  return null
}

/** Wipe Supabase tokens and notify the renderer that the session is dead.
 *  Called when refresh definitively fails (revoked token, invalid grant, etc.). */
function clearSupabaseAuth(): void {
  const tokens = settingsStore.get('oauthTokens') || {}
  delete tokens.supabase
  settingsStore.set('oauthTokens', tokens)
  settingsStore.delete('supabaseUser')
  settingsStore.delete('supabaseAuth')
  console.warn('[Supabase] Tokens cleared — session expired')

  const win = getMainWindow?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send('oauth:supabase:expired')
  }
}

/** Single-flight lock: all concurrent 401s share one refresh attempt. */
let refreshInFlight: Promise<string | null> | null = null

/** Use the refresh token to obtain a new access token.
 *  Concurrent callers coalesce onto the same in-flight request. */
async function refreshSupabaseToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = doRefresh()
  return refreshInFlight
}

async function doRefresh(): Promise<string | null> {
  try {
    const refreshToken = getSupabaseRefreshToken()
    if (!refreshToken) {
      console.warn('[Supabase] No refresh token available — re-auth required')
      return null
    }

    const basicAuth = Buffer.from(`${SUPABASE_CLIENT_ID}:${SUPABASE_CLIENT_SECRET}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`
      },
      body: body.toString()
    })

    if (!res.ok) {
      console.error('[Supabase] Token refresh failed:', res.status)
      // 400/401/403 = token is definitively dead, clear it
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        clearSupabaseAuth()
      }
      return null
    }

    const data = await res.json() as Record<string, unknown>
    if (typeof data.access_token !== 'string' || !data.access_token) {
      console.error('[Supabase] Token refresh response missing or invalid access_token')
      clearSupabaseAuth()
      return null
    }

    const newAccessToken = data.access_token
    const newRefreshToken = (typeof data.refresh_token === 'string' && data.refresh_token) ? data.refresh_token : refreshToken

    // Update stored tokens
    const tokens = settingsStore.get('oauthTokens') || {}
    tokens.supabase = { accessToken: newAccessToken, refreshToken: newRefreshToken }
    settingsStore.set('oauthTokens', tokens)
    console.log('[Supabase] Token refreshed successfully')
    return newAccessToken
  } catch (err) {
    console.error('[Supabase] Token refresh exception:', err)
    return null
  } finally {
    refreshInFlight = null
  }
}

/** Fetch wrapper that auto-refreshes on 401.
 *  Retries the request exactly once with a fresh token. */
async function supabaseFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getSupabaseToken()
  if (!token) throw new Error('Not connected to Supabase')

  const headers = { ...init?.headers, Authorization: `Bearer ${token}` } as Record<string, string>
  const res = await fetch(url, { ...init, headers })

  if (res.status === 401) {
    console.log('[Supabase] Got 401 — attempting token refresh')
    const newToken = await refreshSupabaseToken()
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`
      return fetch(url, { ...init, headers })
    }
  }

  return res
}

/** Fetch the authenticated user's profile from Supabase.
 *  Tries /v1/profile first, then falls back to org name from /v1/organizations. */
async function fetchSupabaseUser(
  token: string
): Promise<{ id: string; name: string; email: string; avatar_url: string | null }> {
  // Try /v1/profile (may fail if scope not available)
  try {
    const res = await fetch(supabaseApi('/profile'), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      const data = (await res.json()) as {
        id: string
        primary_email: string
        first_name?: string
        last_name?: string
        avatar_url?: string
      }
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || 'Supabase User'
      console.log('[Supabase] Profile fetched:', data.primary_email)
      return {
        id: data.id,
        name,
        email: data.primary_email,
        avatar_url: data.avatar_url || null
      }
    }
    console.warn('[Supabase] /v1/profile returned', res.status, '— falling back to org info')
  } catch (err) {
    console.warn('[Supabase] /v1/profile failed:', err, '— falling back to org info')
  }

  // Fallback: use organization name
  try {
    const res = await fetch(supabaseApi('/organizations'), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      const orgs = (await res.json()) as Array<{ id: string; name: string }>
      if (orgs.length > 0) {
        console.log('[Supabase] Using org name as display name:', orgs[0].name)
        return {
          id: orgs[0].id,
          name: orgs[0].name,
          email: orgs[0].name,
          avatar_url: null
        }
      }
    }
  } catch {
    // ignore
  }

  // Last resort fallback
  return { id: 'unknown', name: 'Supabase User', email: 'Connected', avatar_url: null }
}

/** Detect the user's primary organization ID. */
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
  getMainWindow = getWindow
  // ── OAuth start: child BrowserWindow + local callback server ──────────
  ipcMain.handle('oauth:supabase:start', async () => {
    const win = getWindow()
    if (!win) return { error: 'No window available' }
    if (!SUPABASE_CLIENT_ID || !SUPABASE_CLIENT_SECRET) {
      return { error: 'Supabase OAuth not configured — set SUPABASE_CLIENT_ID and SUPABASE_CLIENT_SECRET environment variables' }
    }

    cleanupAuthWindow()
    cleanupServer()

    const state = crypto.randomBytes(16).toString('hex')
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    return new Promise<{ token: string } | { error: string }>((resolve) => {
      pendingResolve = resolve

      const finish = (result: { token: string } | { error: string }) => {
        clearTimeout(timeout)
        // Grab and null out resolve BEFORE cleanup to prevent the
        // closed event from racing and resolving with 'Cancelled'
        const res = pendingResolve
        pendingResolve = null
        cleanupAuthWindow()
        cleanupServer()
        if (res) res(result)
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
          res.end('<html><body><h2>Authorization failed</h2><p>You can close this window.</p></body></html>')
          finish({ error: 'Invalid callback — state mismatch or missing code' })
          return
        }

        // Exchange code for access token (Basic Auth + PKCE)
        try {
          const basicAuth = Buffer.from(`${SUPABASE_CLIENT_ID}:${SUPABASE_CLIENT_SECRET}`).toString('base64')
          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier,
            redirect_uri: REDIRECT_URI
          })
          const tokenRes = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              Authorization: `Basic ${basicAuth}`
            },
            body: body.toString()
          })

          const tokenText = await tokenRes.text()

          let data: Record<string, unknown>
          try {
            data = JSON.parse(tokenText)
          } catch {
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Invalid response from Supabase</h2></body></html>')
            finish({ error: `Invalid token response (status ${tokenRes.status})` })
            return
          }

          // Sanitized log — never print token values
          console.log('[Supabase] Token exchange:', {
            status: tokenRes.status,
            expires_in: data.expires_in,
            hasRefreshToken: !!data.refresh_token,
            accessTokenLen: typeof data.access_token === 'string' ? data.access_token.length : 0,
            tokenType: data.token_type
          })

          if (data.access_token) {
            const accessToken = data.access_token as string
            const refreshToken = (data.refresh_token as string) || null

            // Store both access and refresh tokens
            const tokens = settingsStore.get('oauthTokens') || {}
            tokens.supabase = refreshToken
              ? { accessToken, refreshToken }
              : accessToken  // fallback to legacy format if no refresh token
            settingsStore.set('oauthTokens', tokens)

            // Fetch and store user profile (always returns a user, with fallbacks)
            const user = await fetchSupabaseUser(accessToken)
            settingsStore.set('supabaseUser', user)
            console.log('[Supabase] User stored:', JSON.stringify(user))

            // Detect org
            const orgId = await fetchSupabaseOrg(accessToken)
            if (orgId) {
              settingsStore.set('supabaseAuth', { orgId })
              console.log('[Supabase] Org:', orgId)
            }

            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#4AEAFF">Connected to Supabase!</h2><p style="opacity:0.5">This window will close automatically.</p></div></body></html>')
            // Finish immediately — don't delay or the window close event can race
            finish({ token: accessToken })
          } else {
            const errMsg = (data.error_description as string)
              || (data.message as string)
              || (typeof data.error === 'string' ? data.error : null)
              || (typeof data.error === 'object' && data.error !== null
                  ? JSON.stringify(data.error)
                  : null)
              || `Token exchange failed (${tokenRes.status})`
            console.error('[Supabase] Token exchange error:', errMsg, data)
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(`<html><body><h2>Authorization failed</h2><p>${errMsg}</p></body></html>`)
            finish({ error: errMsg })
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Server error</h2></body></html>')
          finish({ error: `Token exchange failed: ${err}` })
        }
      })

      callbackServer = server

      // Listen on fixed port, then open auth URL in child window
      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        const authUrl = new URL(AUTH_URL)
        authUrl.searchParams.set('client_id', SUPABASE_CLIENT_ID)
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('code_challenge', codeChallenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')

        // Open a child window centered on the parent
        const parentBounds = win.getBounds()
        const width = 520
        const height = 700
        authWindow = new BrowserWindow({
          width,
          height,
          x: Math.round(parentBounds.x + (parentBounds.width - width) / 2),
          y: Math.round(parentBounds.y + (parentBounds.height - height) / 2),
          parent: win,
          modal: true,
          show: false,
          title: 'Connect to Supabase',
          backgroundColor: '#1a1a2e',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        })

        authWindow.once('ready-to-show', () => authWindow?.show())
        authWindow.on('closed', () => {
          authWindow = null
          // If auth wasn't completed, treat as cancel
          if (pendingResolve) {
            finish({ error: 'Cancelled' })
          }
        })

        authWindow.loadURL(authUrl.toString())
      })
    })
  })

  // ── Cancel ────────────────────────────────────────────────────────────
  ipcMain.handle('oauth:supabase:cancel', () => {
    cleanupAuthWindow()
    cleanupServer()
    if (pendingResolve) {
      pendingResolve({ error: 'Cancelled' })
      pendingResolve = null
    }
    return { cancelled: true }
  })

  // ── Update bounds (no-op — child window manages its own size) ───────
  ipcMain.on('oauth:supabase:updateBounds', () => {})

  // ── Status with user info (auto-fetches profile if missing) ───────────
  ipcMain.handle('oauth:supabase:status', async () => {
    let token = getSupabaseToken()

    let user = settingsStore.get('supabaseUser') as
      | { id: string; name: string; email: string; avatar_url: string | null }
      | undefined

    // Auto-fetch user profile if we have a token but no stored user
    if (token && !user) {
      const fetched = await fetchSupabaseUser(token)
      // If profile fetch returned a placeholder, the token might be expired
      if (fetched.id === 'unknown') {
        const refreshed = await refreshSupabaseToken()
        if (refreshed) {
          token = refreshed
          const retried = await fetchSupabaseUser(token)
          settingsStore.set('supabaseUser', retried)
          user = retried
        }
      } else {
        settingsStore.set('supabaseUser', fetched)
        user = fetched
      }
    }

    return {
      connected: !!token,
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
  })

  // ════════════════════════════════════════════════════════════════════════
  // Supabase API Handlers
  // ════════════════════════════════════════════════════════════════════════

  // ── List projects ─────────────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:listProjects',
    async (): Promise<
      Array<{ id: string; name: string; ref: string; region: string; status: string }> | { error: string }
    > => {
      try {
        const res = await supabaseFetch(supabaseApi('/projects'))
        if (!res.ok) {
          const errBody = await res.text()
          console.error('[Supabase] listProjects error:', res.status, errBody)
          return { error: `Supabase API error (${res.status})` }
        }
        const projects = (await res.json()) as Array<{
          id: string
          name: string
          ref: string
          region: string
          status: string
        }>
        console.log('[Supabase] Found', projects.length, 'projects')
        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          ref: p.ref,
          region: p.region,
          status: p.status
        }))
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
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
      projectRef: string
    ): Promise<
      {
        id: string
        name: string
        ref: string
        region: string
        status: string
        dbHost: string
      } | { error: string }
    > => {
      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${projectRef}`))
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const data = (await res.json()) as {
          id: string
          name: string
          ref: string
          region: string
          status: string
          database?: { host: string }
        }
        return {
          id: data.id,
          name: data.name,
          ref: data.ref || projectRef,
          region: data.region,
          status: data.status,
          dbHost: data.database?.host || `db.${projectRef}.supabase.co`
        }
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
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
      Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }> | { error: string }
    > => {
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
      `.trim()

      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${ref}/database/query`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const rows = (await res.json()) as Array<{
          schema: string
          name: string
          columns: Array<{ name: string; type: string; nullable: boolean }>
        }>
        return rows
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
        return { error: `Failed to list tables: ${err}` }
      }
    }
  )

  // ── Run arbitrary SQL ─────────────────────────────────────────────────
  ipcMain.handle(
    'oauth:supabase:runSql',
    async (
      _event,
      ref: string,
      sql: string
    ): Promise<{ rows: unknown[]; rowCount: number } | { error: string }> => {
      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${ref}/database/query`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) {
          const errBody = await res.text()
          console.error('[Supabase] runSql error:', res.status, errBody)
          return { error: `SQL error (${res.status}): ${errBody}` }
        }
        const rows = (await res.json()) as unknown[]
        return { rows, rowCount: Array.isArray(rows) ? rows.length : 0 }
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
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
      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${ref}/functions`))
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
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
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
      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${ref}/storage/buckets`))
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
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
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
      Array<{ table: string; name: string; command: string; definition: string }> | { error: string }
    > => {
      const sql = `
        SELECT
          schemaname || '.' || tablename as table,
          policyname as name,
          cmd as command,
          COALESCE(qual::text, '') as definition
        FROM pg_policies
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, tablename, policyname
      `.trim()

      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${ref}/database/query`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const rows = (await res.json()) as Array<{
          table: string
          name: string
          command: string
          definition: string
        }>
        return rows
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
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
      { url: string; anonKey: string; serviceKey: string; dbUrl: string } | { error: string }
    > => {
      try {
        const res = await supabaseFetch(supabaseApi(`/projects/${ref}/api-keys`))
        if (!res.ok) return { error: `Supabase API error (${res.status})` }
        const keys = (await res.json()) as Array<{ name: string; api_key: string }>
        const anonKey = keys.find((k) => k.name === 'anon')?.api_key || ''
        const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key || ''
        return {
          url: `https://${ref}.supabase.co`,
          anonKey,
          serviceKey,
          dbUrl: `postgresql://postgres:[YOUR-PASSWORD]@db.${ref}.supabase.co:5432/postgres`
        }
      } catch (err: any) {
        if (err?.message === 'Not connected to Supabase') return { error: err.message }
        return { error: `Failed to fetch connection info: ${err}` }
      }
    }
  )
}
