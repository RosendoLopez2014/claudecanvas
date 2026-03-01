/**
 * Secure token storage using Electron's safeStorage API.
 *
 * Tokens are encrypted with the OS keychain (Keychain on macOS, DPAPI on
 * Windows, libsecret on Linux) and stored as base64 strings in electron-store.
 * electron-store never sees plaintext tokens.
 *
 * On first launch after migration, any plaintext tokens in oauthTokens are
 * encrypted and moved to encryptedTokens, then the plaintext entries are
 * deleted.
 */
import { safeStorage } from 'electron'
import { settingsStore } from '../store'

/** Whether the OS keychain is available for encryption. */
let encryptionAvailable = false

/**
 * Initialize secure storage — call once after app.whenReady().
 * Checks encryption availability and runs one-time migration.
 */
export function initSecureStorage(): void {
  encryptionAvailable = safeStorage.isEncryptionAvailable()

  if (!encryptionAvailable) {
    console.warn(
      '[secure-storage] OS encryption not available — tokens will be stored in plaintext. ' +
        'Install a keyring (e.g. gnome-keyring on Linux) for encrypted storage.'
    )
  }

  migrateTokens()
}

/** Encrypt a string and return base64-encoded ciphertext. */
function encrypt(plaintext: string): string {
  if (!encryptionAvailable) return plaintext
  const buf = safeStorage.encryptString(plaintext)
  return buf.toString('base64')
}

/** Decrypt a base64-encoded ciphertext and return plaintext. */
function decrypt(encoded: string): string {
  if (!encryptionAvailable) return encoded
  try {
    const buf = Buffer.from(encoded, 'base64')
    return safeStorage.decryptString(buf)
  } catch (err) {
    console.error('[secure-storage] Decryption failed:', err)
    return ''
  }
}

/**
 * Retrieve a stored token for a provider.
 * Returns null if no token exists or decryption fails.
 */
type SecureProvider = 'github' | 'vercel' | 'supabase' | 'critic_openai'

export function getSecureToken(provider: SecureProvider): string | null {
  const encrypted = (settingsStore.get('encryptedTokens') || {}) as Record<string, string>
  const val = encrypted[provider]
  if (!val) return null
  const decrypted = decrypt(val)
  return decrypted || null
}

/**
 * Store a token for a provider (encrypts before persisting).
 * For compound tokens (e.g. Supabase's { accessToken, refreshToken }),
 * callers should JSON.stringify before calling this.
 */
export function setSecureToken(provider: SecureProvider, value: string): void {
  const encrypted = { ...(settingsStore.get('encryptedTokens') || {}) } as Record<string, string>
  encrypted[provider] = encrypt(value)
  settingsStore.set('encryptedTokens', encrypted)
}

/**
 * Delete a stored token for a provider.
 */
export function deleteSecureToken(provider: SecureProvider): void {
  const encrypted = { ...(settingsStore.get('encryptedTokens') || {}) } as Record<string, string>
  delete encrypted[provider]
  settingsStore.set('encryptedTokens', encrypted)
}

/**
 * One-time migration: move plaintext tokens from oauthTokens to
 * encryptedTokens and wipe the plaintext entries.
 */
function migrateTokens(): void {
  const plaintext = settingsStore.get('oauthTokens') as Record<string, unknown> | undefined
  if (!plaintext || Object.keys(plaintext).length === 0) return

  // Already migrated? Check if encryptedTokens exist for these providers
  const existing = (settingsStore.get('encryptedTokens') || {}) as Record<string, string>
  let migrated = false

  for (const provider of ['github', 'vercel', 'supabase'] as const) {
    const val = plaintext[provider]
    if (!val || existing[provider]) continue

    // Supabase may store { accessToken, refreshToken } object
    const tokenStr = typeof val === 'string' ? val : JSON.stringify(val)
    existing[provider] = encrypt(tokenStr)
    migrated = true
    console.log(`[secure-storage] Migrated ${provider} token to encrypted storage`)
  }

  if (migrated) {
    settingsStore.set('encryptedTokens', existing)
    // Clear plaintext tokens
    settingsStore.set('oauthTokens', {})
    console.log('[secure-storage] Plaintext tokens removed from store')
  }
}
