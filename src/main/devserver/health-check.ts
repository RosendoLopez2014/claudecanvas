/**
 * Self-Healing Loop — Health check.
 *
 * Verifies the dev server is actually serving HTTP after a restart.
 * Uses Electron's net module (same approach as the URL probe in runner.ts).
 */
import { net } from 'electron'
import {
  REPAIR_HEALTH_TIMEOUT_MS,
  REPAIR_HEALTH_RETRIES,
  REPAIR_HEALTH_RETRY_DELAY_MS,
} from '../../shared/constants'

export interface HealthCheckResult {
  healthy: boolean
  url: string
  statusCode?: number
  latencyMs: number
  error?: string
}

/** Probe a URL via HTTP GET. Returns structured result. */
async function probe(url: string, timeoutMs: number): Promise<HealthCheckResult> {
  const start = Date.now()
  return new Promise<HealthCheckResult>((resolve) => {
    const req = net.request({ url, method: 'GET' })
    const timer = setTimeout(() => {
      req.abort()
      resolve({ healthy: false, url, latencyMs: Date.now() - start, error: 'timeout' })
    }, timeoutMs)

    req.on('response', (res) => {
      clearTimeout(timer)
      const code = res.statusCode ?? 0
      // Any 2xx or 3xx is considered healthy (dev servers often redirect)
      const healthy = code >= 200 && code < 400
      resolve({ healthy, url, statusCode: code, latencyMs: Date.now() - start })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      resolve({ healthy: false, url, latencyMs: Date.now() - start, error: err.message })
    })
    req.end()
  })
}

/**
 * Run health check with retries. Returns the first successful probe
 * or the last failed probe after all retries are exhausted.
 */
export async function checkHealth(
  url: string,
  opts?: { timeoutMs?: number; retries?: number; retryDelayMs?: number },
): Promise<HealthCheckResult> {
  const timeoutMs = opts?.timeoutMs ?? REPAIR_HEALTH_TIMEOUT_MS
  const retries = opts?.retries ?? REPAIR_HEALTH_RETRIES
  const retryDelay = opts?.retryDelayMs ?? REPAIR_HEALTH_RETRY_DELAY_MS

  let lastResult: HealthCheckResult = { healthy: false, url, latencyMs: 0, error: 'no attempts' }

  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, retryDelay))
    lastResult = await probe(url, timeoutMs)
    if (lastResult.healthy) return lastResult
  }

  return lastResult
}
