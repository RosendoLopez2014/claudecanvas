import { ipcMain, WebContentsView, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { settingsStore } from '../store'

// gh CLI's public OAuth client ID — designed for device flow, no secret needed
const GITHUB_CLIENT_ID = '178c6fc778ccc68e1d6a'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEVICE_VERIFY_URL = 'https://github.com/login/device'

let activeAuthView: WebContentsView | null = null
let pendingResolve: ((value: { token: string } | { error: string }) => void) | null = null
let pollingActive = false

function cleanupAuthView(win: BrowserWindow): void {
  pollingActive = false
  if (!activeAuthView) return
  try {
    win.contentView.removeChildView(activeAuthView)
    activeAuthView.webContents.close()
  } catch {
    // View may already be removed
  }
  activeAuthView = null
}

/** Configure gh CLI with the token so terminal git/gh commands work. */
function configureGhCli(token: string): void {
  try {
    const child = execFile('gh', ['auth', 'login', '--with-token'], {
      env: process.env,
      timeout: 10000
    })
    child.stdin?.write(token)
    child.stdin?.end()
    child.on('error', (e) => console.warn('[github] gh CLI config error:', e.message))
  } catch {
    // gh CLI may not be installed
  }
}

/** Revoke gh CLI auth on logout. */
function revokeGhCli(): void {
  try {
    execFile('gh', ['auth', 'logout', '--hostname', 'github.com', '-y'], {
      env: process.env,
      timeout: 10000
    })
  } catch {}
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
}

/** Fetch the authenticated user's login and avatar from GitHub. */
async function fetchGitHubUser(
  token: string
): Promise<{ login: string; avatar_url: string } | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    })
    if (!res.ok) return null
    const data = (await res.json()) as { login: string; avatar_url: string }
    return { login: data.login, avatar_url: data.avatar_url }
  } catch {
    return null
  }
}

/** Request a device code from GitHub. */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'repo,user'
    })
  })
  return res.json() as Promise<DeviceCodeResponse>
}

/** Poll GitHub for the access token until the user completes authorization. */
async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<{ token: string } | { error: string }> {
  const deadline = Date.now() + expiresIn * 1000
  const pollInterval = Math.max(interval, 5) * 1000 // minimum 5s per GitHub docs

  while (pollingActive && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval))
    if (!pollingActive) return { error: 'Cancelled' }

    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })

      const data = (await res.json()) as TokenResponse

      if (data.access_token) {
        return { token: data.access_token }
      }

      if (data.error === 'authorization_pending') {
        continue // User hasn't entered the code yet
      }
      if (data.error === 'slow_down') {
        await new Promise((r) => setTimeout(r, 5000)) // Back off
        continue
      }
      if (data.error === 'expired_token') {
        return { error: 'Code expired — try again' }
      }
      if (data.error === 'access_denied') {
        return { error: 'Access denied' }
      }
      if (data.error) {
        return { error: data.error }
      }
    } catch (err) {
      return { error: `Network error: ${err}` }
    }
  }

  return { error: pollingActive ? 'Code expired — try again' : 'Cancelled' }
}

export function setupGithubOAuth(getWindow: () => BrowserWindow | null): void {
  // Phase 1: Request device code — returns immediately with user_code for display
  ipcMain.handle('oauth:github:requestCode', async () => {
    try {
      const data = await requestDeviceCode()
      return {
        user_code: data.user_code,
        device_code: data.device_code,
        interval: data.interval,
        expires_in: data.expires_in
      }
    } catch (err) {
      return { error: `Failed to reach GitHub: ${err}` }
    }
  })

  // Phase 2: Open GitHub verification page in WebContentsView + poll for token
  ipcMain.handle(
    'oauth:github:start',
    async (
      _event,
      args: {
        bounds: { x: number; y: number; width: number; height: number }
        deviceCode: string
        interval: number
        expiresIn: number
      }
    ) => {
      const win = getWindow()
      if (!win) return { error: 'No window available' }

      if (activeAuthView) {
        // Resolve any pending flow before starting a new one
        if (pendingResolve) {
          pendingResolve({ error: 'Superseded by new auth flow' })
          pendingResolve = null
        }
        cleanupAuthView(win)
      }

      return new Promise<{ token: string } | { error: string }>((resolve) => {
        pendingResolve = resolve
        pollingActive = true

        const authView = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        })

        activeAuthView = authView

        // Position below the tab bar
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

        // 10-minute timeout (device codes typically expire in 15 min)
        const timeout = setTimeout(() => {
          finish({ error: 'Timed out — try again' })
        }, 600000)

        const finish = (result: { token: string } | { error: string }) => {
          clearTimeout(timeout)
          pollingActive = false
          cleanupAuthView(win)
          if (pendingResolve) {
            pendingResolve(result)
            pendingResolve = null
          }
        }

        // Load GitHub's device verification page directly
        authView.webContents.loadURL(DEVICE_VERIFY_URL)

        // Allow popups for Google/Apple sign-in within GitHub
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
          if (url.startsWith('https://')) {
            require('electron').shell.openExternal(url)
          }
          return { action: 'deny' }
        })

        // Poll for token in background
        pollForToken(args.deviceCode, args.interval, args.expiresIn).then(async (result) => {
          if ('token' in result) {
            // Store token in app settings
            const tokens = settingsStore.get('oauthTokens') || {}
            settingsStore.set('oauthTokens', { ...tokens, github: result.token })
            // Fetch and store user profile
            const user = await fetchGitHubUser(result.token)
            if (user) {
              settingsStore.set('githubUser', user)
            }
            // Configure gh CLI for terminal
            configureGhCli(result.token)
            finish({ token: result.token })
          } else {
            finish(result)
          }
        })
      })
    }
  )

  ipcMain.handle('oauth:github:cancel', () => {
    const win = getWindow()
    pollingActive = false
    if (win) cleanupAuthView(win)
    if (pendingResolve) {
      pendingResolve({ error: 'Cancelled' })
      pendingResolve = null
    }
    return { cancelled: true }
  })

  ipcMain.on(
    'oauth:github:updateBounds',
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

  ipcMain.handle('oauth:github:status', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    const user = settingsStore.get('githubUser') as
      | { login: string; avatar_url: string }
      | undefined
    return { connected: !!tokens.github, login: user?.login, avatar_url: user?.avatar_url }
  })

  // List user's repos from GitHub API
  ipcMain.handle(
    'oauth:github:listRepos',
    async (): Promise<Array<{ name: string; full_name: string; html_url: string; private: boolean }> | { error: string }> => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.github
      if (!token) return { error: 'Not connected to GitHub' }

      try {
        const repos: Array<{ name: string; full_name: string; html_url: string; private: boolean }> = []
        let page = 1
        while (page <= 5) {
          const res = await fetch(
            `https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
          )
          if (!res.ok) return { error: `GitHub API error (${res.status})` }
          const data = (await res.json()) as Array<{ name: string; full_name: string; html_url: string; private: boolean }>
          repos.push(...data.map((r) => ({ name: r.name, full_name: r.full_name, html_url: r.html_url, private: r.private })))
          if (data.length < 100) break
          page++
        }
        return repos
      } catch (err) {
        return { error: `Failed to fetch repos: ${err}` }
      }
    }
  )

  // Create a new repo on GitHub (API only — no local git operations)
  ipcMain.handle(
    'oauth:github:createRepo',
    async (
      _event,
      opts: { name: string; private?: boolean }
    ): Promise<{ url: string; owner: string } | { error: string }> => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.github
      if (!token) return { error: 'Not connected to GitHub' }

      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        })
        if (!userRes.ok) return { error: `GitHub auth failed (${userRes.status})` }
        const userData = (await userRes.json()) as { login: string }
        const owner = userData.login

        const createRes = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: opts.name,
            private: opts.private !== false
          })
        })

        if (!createRes.ok) {
          const errData = (await createRes.json()) as { message?: string }
          if (createRes.status !== 422) {
            return { error: errData.message || `GitHub API error (${createRes.status})` }
          }
        }

        return { url: `https://github.com/${owner}/${opts.name}`, owner }
      } catch (err) {
        return { error: `Failed to reach GitHub API: ${err}` }
      }
    }
  )

  // Check if a PR exists for a given branch
  ipcMain.handle(
    'oauth:github:prStatus',
    async (
      _event,
      repoFullName: string,
      branch: string
    ): Promise<
      { hasPR: true; number: number; url: string; title: string } |
      { hasPR: false } |
      { error: string }
    > => {
      const tokens = settingsStore.get('oauthTokens') || {}
      const token = tokens.github
      if (!token) return { error: 'Not connected to GitHub' }

      try {
        const owner = repoFullName.split('/')[0]
        const res = await fetch(
          `https://api.github.com/repos/${repoFullName}/pulls?head=${owner}:${branch}&state=open`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (!res.ok) return { error: `GitHub API error (${res.status})` }
        const data = (await res.json()) as Array<{ number: number; html_url: string; title: string }>
        if (data.length > 0) {
          return { hasPR: true, number: data[0].number, url: data[0].html_url, title: data[0].title }
        }
        return { hasPR: false }
      } catch (err) {
        return { error: `Failed to check PR status: ${err}` }
      }
    }
  )

  ipcMain.handle('oauth:github:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.github
    settingsStore.set('oauthTokens', tokens)
    settingsStore.delete('githubUser')
    revokeGhCli()
  })
}
