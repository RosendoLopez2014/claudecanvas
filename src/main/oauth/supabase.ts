import { ipcMain, shell } from 'electron'
import { settingsStore } from '../store'
import http from 'http'
import { URL } from 'url'

const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID || ''
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET || ''
const REDIRECT_PORT = 38903

export function setupSupabaseOAuth(): void {
  ipcMain.handle('oauth:supabase:start', async () => {
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
          const response = await fetch('https://api.supabase.com/v1/oauth/token', {
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
              redirect_uri: `http://localhost:${REDIRECT_PORT}`
            })
          })

          const data = (await response.json()) as { access_token?: string; error?: string }

          if (data.access_token) {
            const tokens = settingsStore.get('oauthTokens') || {}
            settingsStore.set('oauthTokens', { ...tokens, supabase: data.access_token })
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Connected to Supabase!</h2><p>You can close this tab.</p></body></html>')
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
        const authUrl = `https://api.supabase.com/v1/oauth/authorize?client_id=${SUPABASE_CLIENT_ID}&redirect_uri=http://localhost:${REDIRECT_PORT}&response_type=code`
        shell.openExternal(authUrl)
      })

      setTimeout(() => {
        server.close()
        resolve({ error: 'OAuth timeout' })
      }, 300000)
    })
  })

  ipcMain.handle('oauth:supabase:status', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    return { connected: !!tokens.supabase }
  })

  ipcMain.handle('oauth:supabase:logout', () => {
    const tokens = settingsStore.get('oauthTokens') || {}
    delete tokens.supabase
    settingsStore.set('oauthTokens', tokens)
  })
}
