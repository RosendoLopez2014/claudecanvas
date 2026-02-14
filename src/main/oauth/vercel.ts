import { ipcMain, WebContentsView, BrowserWindow, app } from 'electron'
import { settingsStore } from '../store'
import { OAUTH_TIMEOUT_MS } from '../../shared/constants'
import http from 'http'
import crypto from 'crypto'
import { promises as fsp } from 'fs'
import pathMod from 'path'

const VERCEL_CLIENT_ID = 'oac_pu1SEcYlwguNfVZJ2sd9t3FP'
const VERCEL_CLIENT_SECRET = 'V0MWsY5JzEpfmRpudxNW0DoT'
const AUTH_URL = 'https://vercel.com/integrations/claudecanvas/new'
const TOKEN_URL = 'https://api.vercel.com/v2/oauth/access_token'
const REDIRECT_PORT = 38902
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`

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

/** Build a Vercel API URL with optional teamId query parameter. */
function vercelApi(path: string, extraParams?: Record<string, string>): string {
  const url = new URL(path, 'https://api.vercel.com')
  const auth = settingsStore.get('vercelAuth') as { teamId?: string } | undefined
  if (auth?.teamId) url.searchParams.set('teamId', auth.teamId)
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v)
  }
  return url.toString()
}

/** Fetch the authenticated user's profile from Vercel. */
async function fetchVercelUser(
  token: string
): Promise<{ username: string; name: string | null; avatar: string | null } | null> {
  try {
    const res = await fetch(vercelApi('/v2/user'), {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) {
      console.error('[Vercel] fetchUser error:', res.status, await res.text())
      return null
    }
    const raw = await res.json()
    console.log('[Vercel] fetchUser response keys:', Object.keys(raw))
    // Handle both { user: { ... } } and direct user object
    const userData = raw.user || raw
    if (!userData.username) {
      console.error('[Vercel] No username in response:', JSON.stringify(raw).slice(0, 200))
      return null
    }
    return {
      username: userData.username,
      name: userData.name || null,
      avatar: userData.avatar
        ? `https://vercel.com/api/www/avatar/${userData.avatar}?s=64`
        : null
    }
  } catch (err) {
    console.error('[Vercel] fetchUser exception:', err)
    return null
  }
}

export function setupVercelOAuth(getWindow: () => BrowserWindow | null): void {
  // Single-step: open Vercel login in WebContentsView, handle OAuth callback
  ipcMain.handle(
    'oauth:vercel:start',
    async (
      _event,
      args: { bounds: { x: number; y: number; width: number; height: number } }
    ) => {
      const win = getWindow()
      if (!win) return { error: 'No window available' }

      // Resolve any pending flow before starting a new one
      if (pendingResolve) {
        pendingResolve({ error: 'Superseded by new auth flow' })
        pendingResolve = null
      }
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

        // Start local callback server on a random port
        const server = http.createServer(async (req, res) => {
          const url = new URL(req.url || '', 'http://localhost')
          console.log('[Vercel] Callback params:', Object.fromEntries(url.searchParams.entries()))
          const code = url.searchParams.get('code')
          const returnedState = url.searchParams.get('state')

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>')
            finish({ error: 'Invalid callback — state mismatch or missing code' })
            return
          }

          // Exchange code for access token (Marketplace Integration flow)
          try {
            const tokenRes = await fetch(TOKEN_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
              },
              body: new URLSearchParams({
                client_id: VERCEL_CLIENT_ID,
                client_secret: VERCEL_CLIENT_SECRET,
                code,
                redirect_uri: REDIRECT_URI
              })
            })

            const data = (await tokenRes.json()) as Record<string, unknown>

            console.log('[Vercel] Token exchange response:', JSON.stringify(data))
            // Save debug info
            const debugFile = pathMod.join(app.getPath('userData'), 'vercel-debug.json')
            fsp.writeFile(debugFile, JSON.stringify({ tokenExchange: data, timestamp: Date.now() }, null, 2)).catch((e: Error) => console.warn('[vercel] debug write:', e.message))

            if (data.access_token) {
              const accessToken = data.access_token as string
              const teamId = (data.team_id as string) || null

              // Store token and auth context
              const tokens = settingsStore.get('oauthTokens') || {}
              settingsStore.set('oauthTokens', { ...tokens, vercel: accessToken })
              settingsStore.set('vercelAuth', {
                teamId,
                userId: (data.user_id as string) || null,
                installationId: (data.installation_id as string) || null
              })
              console.log('[Vercel] Connected — teamId:', teamId)

              // Fetch and store user profile
              const user = await fetchVercelUser(accessToken)
              if (user) {
                settingsStore.set('vercelUser', user)
                console.log('[Vercel] User:', user.username)
              }
              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end('<html><body style="background:#000;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connected to Vercel!</h2><p style="opacity:0.5">You can close this tab.</p></div></body></html>')
              finish({ token: data.access_token })
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
          // Marketplace integration install URL — scopes are configured in the Console
          const authUrl = new URL(AUTH_URL)
          authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
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

          // Allow SSO popups within Vercel login
          authView.webContents.setWindowOpenHandler(({ url }) => {
            const allowedPopups = [
              'vercel.com/login',
              'vercel.com/signup',
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

  ipcMain.handle('oauth:vercel:cancel', () => {
    const win = getWindow()
    if (win) cleanupAuthView(win)
    cleanupServer()
    if (pendingResolve) {
      pendingResolve({ error: 'Cancelled' })
      pendingResolve = null
    }
    return { cancelled: true }
  })

  ipcMain.on(
    'oauth:vercel:updateBounds',
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

  // Status with user info (auto-fetches profile if missing)
  ipcMain.handle('oauth:vercel:status', async () => {
    const tokens = settingsStore.get('oauthTokens') || {}

    let user = settingsStore.get('vercelUser') as
      | { username: string; name: string | null; avatar: string | null }
      | undefined

    // Auto-fetch user profile if we have a token but no stored user
    if (tokens.vercel && !user) {
      const fetched = await fetchVercelUser(tokens.vercel)
      if (fetched) {
        settingsStore.set('vercelUser', fetched)
        user = fetched
      }
    }

    return {
      connected: !!tokens.vercel,
      username: user?.username,
      name: user?.name,
      avatar: user?.avatar
    }
  })

  // List user's Vercel projects
  ipcMain.handle(
    'oauth:vercel:listProjects',
    async (): Promise<
      Array<{ id: string; name: string; framework: string | null; url: string | null }> | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.vercel
      if (!token) return { error: 'Not connected to Vercel' }

      try {
        const res = await fetch(vercelApi('/v9/projects', { limit: '100' }), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) {
          const errBody = await res.text()
          console.error('[Vercel] listProjects error:', res.status, errBody)
          return { error: `Vercel API error (${res.status})` }
        }
        const raw = await res.json()
        console.log('[Vercel] listProjects response keys:', Object.keys(raw))
        // Handle both { projects: [...] } and direct array response
        const projects: Array<{
          id: string
          name: string
          framework: string | null
          latestDeployments?: Array<{ url?: string }>
        }> = Array.isArray(raw) ? raw : (raw.projects || [])
        console.log('[Vercel] Found', projects.length, 'projects')
        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          framework: p.framework,
          url: p.latestDeployments?.[0]?.url
            ? `https://${p.latestDeployments[0].url}`
            : null
        }))
      } catch (err) {
        console.error('[Vercel] listProjects exception:', err)
        return { error: `Failed to fetch projects: ${err}` }
      }
    }
  )

  // Get latest deployments for a project
  ipcMain.handle(
    'oauth:vercel:deployments',
    async (
      _event,
      projectId: string
    ): Promise<
      | Array<{
          id: string
          url: string
          state: string
          created: number
          source: string | null
        }>
      | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.vercel
      if (!token) return { error: 'Not connected to Vercel' }

      try {
        const res = await fetch(
          vercelApi('/v6/deployments', { projectId, limit: '10' }),
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) return { error: `Vercel API error (${res.status})` }
        const data = (await res.json()) as {
          deployments: Array<{
            uid: string
            url: string
            state: string
            created: number
            source?: string
          }>
        }
        return data.deployments.map((d) => ({
          id: d.uid,
          url: `https://${d.url}`,
          state: d.state,
          created: d.created,
          source: d.source || null
        }))
      } catch (err) {
        return { error: `Failed to fetch deployments: ${err}` }
      }
    }
  )

  // Get build logs for a deployment
  ipcMain.handle(
    'oauth:vercel:buildLogs',
    async (
      _event,
      deploymentId: string
    ): Promise<Array<{ text: string; created: number; type: string }> | { error: string }> => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.vercel
      if (!token) return { error: 'Not connected to Vercel' }

      try {
        const res = await fetch(
          vercelApi(`/v3/deployments/${deploymentId}/events`),
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (!res.ok) return { error: `Vercel API error (${res.status})` }
        const events = (await res.json()) as Array<{
          type: string
          created: number
          payload: { text?: string }
        }>
        return events
          .filter((e) => e.payload?.text)
          .map((e) => ({
            text: e.payload.text!,
            created: e.created,
            type: e.type
          }))
      } catch (err) {
        return { error: `Failed to fetch logs: ${err}` }
      }
    }
  )

  // Detect linked Vercel project for a workspace
  ipcMain.handle(
    'oauth:vercel:linkedProject',
    async (
      _event,
      args: { projectPath: string; gitRepo?: string }
    ): Promise<
      | {
          linked: true
          project: {
            id: string
            name: string
            framework: string | null
            productionUrl: string
          }
          latestDeployment: {
            id: string
            url: string
            state: string
            created: number
            commitMessage: string | null
          } | null
        }
      | { linked: false }
      | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.vercel
      if (!token) return { error: 'Not connected to Vercel' }

      let projectId: string | null = null

      // 1. Check .vercel/project.json (created by `vercel link`)
      try {
        const raw = await fsp.readFile(
          pathMod.join(args.projectPath, '.vercel', 'project.json'),
          'utf-8'
        )
        const config = JSON.parse(raw)
        if (config.projectId) projectId = config.projectId
      } catch {
        // No .vercel config
      }

      // 2. Match by git remote URL against Vercel projects
      if (!projectId && args.gitRepo) {
        try {
          const res = await fetch(vercelApi('/v9/projects', { limit: '100' }), {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (res.ok) {
            const data = (await res.json()) as {
              projects: Array<{
                id: string
                link?: { repo?: string }
              }>
            }
            const match = data.projects.find(
              (p) => p.link?.repo === args.gitRepo
            )
            if (match) projectId = match.id
          }
        } catch {}
      }

      // 3. Try folder name as project name
      if (!projectId) {
        const folderName = pathMod.basename(args.projectPath).toLowerCase()
        try {
          const res = await fetch(
            vercelApi(`/v9/projects/${encodeURIComponent(folderName)}`),
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (res.ok) {
            const data = (await res.json()) as { id: string }
            projectId = data.id
          }
        } catch {}
      }

      if (!projectId) return { linked: false }

      // 4. Fetch full project details + latest deployment
      try {
        const res = await fetch(
          vercelApi(`/v9/projects/${projectId}`),
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) return { linked: false }
        const project = (await res.json()) as {
          id: string
          name: string
          framework: string | null
        }

        const productionUrl = `https://${project.name}.vercel.app`

        // Fetch latest deployment
        let latestDeployment: {
          id: string
          url: string
          state: string
          created: number
          commitMessage: string | null
        } | null = null

        try {
          const deplRes = await fetch(
            vercelApi('/v6/deployments', { projectId: project.id, limit: '1' }),
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (deplRes.ok) {
            const deplData = (await deplRes.json()) as {
              deployments: Array<{
                uid: string
                url: string
                state: string
                created: number
                meta?: { githubCommitMessage?: string }
              }>
            }
            const d = deplData.deployments?.[0]
            if (d) {
              latestDeployment = {
                id: d.uid,
                url: `https://${d.url}`,
                state: d.state,
                created: d.created,
                commitMessage: d.meta?.githubCommitMessage || null
              }
            }
          }
        } catch {}

        return {
          linked: true,
          project: {
            id: project.id,
            name: project.name,
            framework: project.framework || null,
            productionUrl
          },
          latestDeployment
        }
      } catch {
        return { linked: false }
      }
    }
  )

  // Import (create) a new Vercel project linked to a GitHub repo
  ipcMain.handle(
    'oauth:vercel:importProject',
    async (
      _event,
      opts: { name: string; framework?: string; gitRepo: string }
    ): Promise<
      { id: string; name: string; productionUrl: string } | { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.vercel
      if (!token) return { error: 'Not connected to Vercel' }

      try {
        const body: Record<string, unknown> = {
          name: opts.name,
          gitRepository: {
            type: 'github',
            repo: opts.gitRepo
          }
        }
        if (opts.framework) body.framework = opts.framework

        const res = await fetch(vercelApi('/v10/projects'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })

        if (!res.ok) {
          const err = (await res.json()) as { error?: { message?: string } }
          return {
            error: err.error?.message || `Vercel API error (${res.status})`
          }
        }

        const project = (await res.json()) as { id: string; name: string }
        return {
          id: project.id,
          name: project.name,
          productionUrl: `https://${project.name}.vercel.app`
        }
      } catch (err) {
        return { error: `Failed to import project: ${err}` }
      }
    }
  )

  // Redeploy a deployment to production
  ipcMain.handle(
    'oauth:vercel:redeploy',
    async (
      _event,
      deploymentId: string
    ): Promise<{ id: string; url: string; state: string } | { error: string }> => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.vercel
      if (!token) return { error: 'Not connected to Vercel' }

      try {
        const res = await fetch(vercelApi('/v13/deployments', { forceNew: '1' }), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            deploymentId,
            name: undefined,
            target: 'production'
          })
        })

        if (!res.ok) {
          const err = (await res.json()) as { error?: { message?: string } }
          return {
            error: err.error?.message || `Vercel API error (${res.status})`
          }
        }

        const data = (await res.json()) as { id: string; url: string; status: string }
        return {
          id: data.id,
          url: `https://${data.url}`,
          state: data.status
        }
      } catch (err) {
        return { error: `Failed to redeploy: ${err}` }
      }
    }
  )

  // Logout
  ipcMain.handle('oauth:vercel:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.vercel
    settingsStore.set('oauthTokens', tokens)
    settingsStore.delete('vercelUser')
    settingsStore.delete('vercelAuth')
    const win = getWindow()
    if (win) cleanupAuthView(win)
  })
}
