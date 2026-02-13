import { ipcMain, shell, BrowserWindow } from 'electron'
import { settingsStore } from '../store'
import http from 'http'
import { URL } from 'url'

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const REDIRECT_PORT = 38901

export function setupGithubOAuth(): void {
  ipcMain.handle('oauth:github:start', async () => {
    return new Promise<{ token: string } | { error: string }>((resolve) => {
      // Start local server to receive callback
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`)
        const code = url.searchParams.get('code')

        if (!code) {
          res.writeHead(400)
          res.end('Missing code parameter')
          server.close()
          resolve({ error: 'Missing code' })
          return
        }

        try {
          // Exchange code for token
          const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({
              client_id: GITHUB_CLIENT_ID,
              client_secret: GITHUB_CLIENT_SECRET,
              code
            })
          })

          const data = (await response.json()) as { access_token?: string; error?: string }

          if (data.access_token) {
            const tokens = settingsStore.get('oauthTokens') || {}
            settingsStore.set('oauthTokens', { ...tokens, github: data.access_token })
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Connected to GitHub!</h2><p>You can close this tab.</p></body></html>')
            resolve({ token: data.access_token })
          } else {
            res.writeHead(400)
            res.end('OAuth failed')
            resolve({ error: data.error || 'Unknown error' })
          }
        } catch (err) {
          res.writeHead(500)
          res.end('Server error')
          resolve({ error: String(err) })
        }

        server.close()
      })

      server.listen(REDIRECT_PORT, () => {
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=http://localhost:${REDIRECT_PORT}&scope=repo,user`
        shell.openExternal(authUrl)
      })

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close()
        resolve({ error: 'OAuth timeout' })
      }, 300000)
    })
  })

  ipcMain.handle('oauth:github:status', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    return { connected: !!tokens.github }
  })

  ipcMain.handle('oauth:github:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.github
    settingsStore.set('oauthTokens', tokens)
  })
}
