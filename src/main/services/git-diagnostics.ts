import * as fs from 'fs'

// ── EBADF diagnostics ─────────────────────────────────────────────────
// All diagnostics use ONLY synchronous fs calls (no spawn) to avoid
// triggering more EBADF from child_process.
let lastFdDiagTime = 0
let fdCategorizationDone = false

/** Count open FDs via /dev/fd (kernel-provided, per-process on macOS). */
export function countOpenFds(): number {
  try {
    return fs.readdirSync('/dev/fd').length
  } catch {
    return -1
  }
}

/**
 * Categorize open FDs by type using fstatSync (no spawn needed).
 * Samples up to `sampleSize` FDs evenly across the full range.
 */
export function categorizeFds(sampleSize = 300): Record<string, number> {
  const types: Record<string, number> = {}
  let entries: number[]
  try {
    entries = fs.readdirSync('/dev/fd').map(Number).filter((n) => !isNaN(n))
  } catch {
    return types
  }

  // Sample evenly if there are more entries than sampleSize
  const step = entries.length > sampleSize ? Math.floor(entries.length / sampleSize) : 1
  let sampled = 0
  for (let i = 0; i < entries.length && sampled < sampleSize; i += step) {
    try {
      const stat = fs.fstatSync(entries[i])
      let type = 'other'
      if (stat.isFIFO()) type = 'FIFO/pipe'
      else if (stat.isSocket()) type = 'socket'
      else if (stat.isCharacterDevice()) type = 'chardev'
      else if (stat.isBlockDevice()) type = 'blockdev'
      else if (stat.isDirectory()) type = 'dir'
      else if (stat.isFile()) type = 'file'
      types[type] = (types[type] || 0) + 1
      sampled++
    } catch {
      types['error/closed'] = (types['error/closed'] || 0) + 1
      sampled++
    }
  }

  // Scale sampled counts to estimate total if we sampled a subset
  if (step > 1) {
    for (const key of Object.keys(types)) {
      types[key] = Math.round(types[key] * step)
    }
    types['_sampled'] = sampled
    types['_total'] = entries.length
  }

  return types
}

/**
 * Check whether an error is an EBADF (bad file descriptor) error.
 * node-pty leaks FDs into child processes, so git spawns can fail transiently.
 * Checks err.code, err.message, and recursive err.cause chain.
 */
export function isEbadfError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (e.code === 'EBADF') return true
    if (String(e.message || '').includes('EBADF')) return true
    if (e.cause) return isEbadfError(e.cause)
  }
  if (typeof err === 'string' && err.includes('EBADF')) return true
  return false
}

/**
 * Log FD diagnostics (throttled to once per 2 seconds).
 * Requires `gitQueuesSize` and `gitInstancesSize` to be passed in
 * to avoid circular dependency with git-queue.
 */
export function logFdDiagnostics(context: string, gitQueuesSize: number, gitInstancesSize: number): void {
  const now = Date.now()
  // Throttle to once per 2 seconds to avoid spam
  if (now - lastFdDiagTime < 2000) return
  lastFdDiagTime = now

  try {
    const fdCount = countOpenFds()
    const ptyCount = (globalThis as any).__ptyCount?.() ?? '?'
    const ptyClosing = (globalThis as any).__ptyClosingCount?.() ?? '?'

    // Max FD number shows how sparse the FD table is
    let maxFd = -1
    try {
      const entries = fs.readdirSync('/dev/fd').map(Number).filter((n) => !isNaN(n))
      maxFd = Math.max(...entries)
    } catch {}

    console.warn(
      `[git] EBADF DIAG: context=${context}, pid=${process.pid}, openFDs=${fdCount}, maxFD=${maxFd}, ptyCount=${ptyCount}, ptyClosing=${ptyClosing}, gitQueues=${gitQueuesSize}, gitInstances=${gitInstancesSize}`
    )

    // One-time FD categorization (no spawn — uses fstatSync)
    if (!fdCategorizationDone) {
      fdCategorizationDone = true
      const cats = categorizeFds()
      const sorted = Object.entries(cats)
        .filter(([k]) => !k.startsWith('_'))
        .sort((a, b) => b[1] - a[1])
      console.warn(
        `[git] FD CATEGORIES (no-spawn): ${sorted.map(([t, n]) => `${t}=${n}`).join(', ')}` +
        (cats._total ? ` (sampled ${cats._sampled} of ${cats._total})` : '')
      )
    }
  } catch (err) {
    console.warn(`[git] EBADF DIAG failed:`, err)
  }
}
