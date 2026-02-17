import Store from 'electron-store'
import { ipcMain } from 'electron'

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
  /** @deprecated Plaintext tokens — migrated to encryptedTokens on first run. */
  oauthTokens: {
    github?: string
    vercel?: string
    supabase?: string | { accessToken: string; refreshToken: string }
  }
  /** Encrypted tokens (base64-encoded safeStorage ciphertext). */
  encryptedTokens: Record<string, string>
  githubUser?: { login: string; avatar_url: string }
  vercelUser?: { username: string; name: string | null; avatar: string | null }
  supabaseUser?: { id: string; name: string; email: string; avatar_url: string | null }
  supabaseAuth?: { orgId: string }
  gitPushMode: 'solo' | 'team' | 'contributor'
}

export const settingsStore = new Store<SettingsSchema>({
  defaults: {
    projectsDir: '',
    recentProjects: [],
    theme: 'dark',
    onboardingComplete: false,
    oauthTokens: {},
    encryptedTokens: {},
    gitPushMode: 'solo'
  }
})

export function setupSettingsHandlers(): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    return settingsStore.get(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    settingsStore.set(key, value)
  })

  ipcMain.handle('settings:getAll', () => {
    return settingsStore.store
  })
}
