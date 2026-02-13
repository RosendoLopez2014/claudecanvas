import { ipcMain, shell } from 'electron'
import { settingsStore } from '../store'
import http from 'http'
import { URL } from 'url'

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || ''
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || ''
const REDIRECT_PORT = 38902

export function setupVercelOAuth(): void {
  ipcMain.handle('oauth:vercel:start', async () => {
    return new Promise<{ token: string } | { error: string }>((resolve) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`)
        const code = url.searchParams.get('code')

        if (!code) {
          res.writeHead(400)
          res.end('Missing code')
          server.close()
          resolve({ error: 'Missing code' })
          return
        }

        try {
          const response = await fetch('https://api.vercel.com/v2/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: VERCEL_CLIENT_ID,
              client_secret: VERCEL_CLIENT_SECRET,
              code,
              redirect_uri: `http://localhost:${REDIRECT_PORT}`
            })
          })

          const data = (await response.json()) as { access_token?: string; error?: string }

          if (data.access_token) {
            const tokens = settingsStore.get('oauthTokens') || {}
            settingsStore.set('oauthTokens', { ...tokens, vercel: data.access_token })
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Connected to Vercel!</h2><p>You can close this tab.</p></body></html>')
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
        const authUrl = `https://vercel.com/integrations/new?client_id=${VERCEL_CLIENT_ID}&redirect_uri=http://localhost:${REDIRECT_PORT}`
        shell.openExternal(authUrl)
      })

      setTimeout(() => {
        server.close()
        resolve({ error: 'OAuth timeout' })
      }, 300000)
    })
  })

  ipcMain.handle('oauth:vercel:status', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    return { connected: !!tokens.vercel }
  })

  ipcMain.handle('oauth:vercel:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.vercel
    settingsStore.set('oauthTokens', tokens)
  })
}
