/**
 * Stale Dev Server Cleanup — scoped to a single project directory.
 *
 * Before each restart attempt, the self-healing loop calls cleanupStaleDevServer()
 * to remove framework lock files and kill orphaned processes that would prevent
 * a fresh start. All operations are strictly scoped to the project's cwd —
 * we never touch processes or files belonging to other projects.
 */
import { execSync } from 'child_process'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'

const TAG = '[stale-cleanup]'

/** Framework-specific lock files (relative to project root) that block dev server startup. */
const FRAMEWORK_LOCK_FILES = [
  '.next/dev/lock',   // Next.js
  '.nuxt/dev/lock',   // Nuxt 3
]

/**
 * Clean up stale dev server artifacts before a restart attempt.
 *
 * 1. Removes framework lock files (e.g. .next/dev/lock)
 * 2. Kills stale processes listening on the expected port — but ONLY if
 *    the process's working directory is at or under `cwd`.
 *
 * Returns a summary of what was cleaned up (for logging).
 */
export function cleanupStaleDevServer(
  cwd: string,
  port?: number,
): { locksRemoved: string[]; processesKilled: number[] } {
  const locksRemoved = removeFrameworkLocks(cwd)
  const processesKilled = port ? killStalePortProcesses(cwd, port) : []

  return { locksRemoved, processesKilled }
}

// ── Framework Lock Files ──────────────────────────────────

function removeFrameworkLocks(cwd: string): string[] {
  const removed: string[] = []

  for (const rel of FRAMEWORK_LOCK_FILES) {
    const full = join(cwd, rel)
    try {
      if (existsSync(full)) {
        unlinkSync(full)
        removed.push(rel)
        console.log(`${TAG} Removed stale lock: ${rel}`)
      }
    } catch { /* file may have been removed between check and unlink */ }
  }

  return removed
}

// ── Stale Port Process Cleanup (macOS/Linux only) ─────────

function killStalePortProcesses(cwd: string, port: number): number[] {
  // lsof is not available on Windows
  if (process.platform === 'win32') return []

  const killed: number[] = []

  try {
    // Find PIDs listening on the target port
    const pidOutput = execSync(`lsof -ti :${port} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()

    if (!pidOutput) return killed

    const pids = pidOutput
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n !== process.pid)

    for (const pid of pids) {
      try {
        // Read the process's working directory via lsof
        const raw = execSync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()

        // Parse output: lines starting with 'n' contain the path
        const nameLine = raw.split('\n').find((l) => l.startsWith('n'))
        const procCwd = nameLine ? nameLine.slice(1) : ''

        // Only kill if the process belongs to this project
        if (procCwd && (procCwd === cwd || procCwd.startsWith(cwd + '/'))) {
          process.kill(pid, 'SIGTERM')
          killed.push(pid)
          console.log(`${TAG} Killed stale process ${pid} on port ${port} (cwd: ${procCwd})`)
        }
      } catch { /* process may have already exited */ }
    }
  } catch { /* lsof failed or no processes found */ }

  return killed
}
