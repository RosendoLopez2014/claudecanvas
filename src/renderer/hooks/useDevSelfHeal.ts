/**
 * Dev Server Crash Bridge — surfaces crash errors to MCP.
 *
 * Listens for `dev:crash-report` IPC from main process and adds the error
 * to the active tab's previewErrors. This makes the crash visible via the
 * `canvas_get_errors` MCP tool so Claude Code can discover and fix it.
 *
 * Also listens for `dev:repair-event` to track the repairId and logPath
 * so the error message points Claude to the right crash log.
 *
 * All retry/restart logic lives in the main process self-healing loop
 * (src/main/devserver/self-healing-loop.ts). This hook is a passive bridge.
 */
import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useDevRepairStore } from '@/stores/devRepair'

export function useDevSelfHeal(): void {
  // Track which projects have already had errors surfaced (avoid duplicates)
  const surfacedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const remove = window.api.dev.onCrashReport(({ cwd, code, output }) => {
      if (code === 0 || code === null) return

      const store = useTabsStore.getState()
      const tab = store.tabs.find((t) => t.project.path === cwd)
      if (!tab) return

      // Check if there's a repair session with repairId/logPath
      const repairState = useDevRepairStore.getState()
      const activeRepair = repairState.activeRepairs[cwd]
      const repairId = activeRepair?.repairId ?? null
      const logPath = repairId
        ? `.dev-crash.${repairId.slice(0, 8)}.log`
        : '.dev-crash.log'

      // Avoid duplicate errors for the same crash
      const key = `${cwd}:${code}:${Date.now()}`
      if (surfacedRef.current.has(cwd)) return
      surfacedRef.current.add(cwd)
      // Clear after 5s to allow new crashes to be surfaced
      setTimeout(() => surfacedRef.current.delete(cwd), 5000)

      const errorSummary = extractError(output)

      // Build error message that points Claude to the repair task
      const repairHint = repairId
        ? ` Use canvas_get_repair_task() to get repair instructions (repairId: ${repairId.slice(0, 8)}).`
        : ''

      store.addPreviewError(tab.id, {
        message: `[Dev Server Crash] exit code ${code}: ${errorSummary}. Full log: ${logPath}.${repairHint}`,
        file: logPath,
        line: null,
        column: null,
      })
    })
    return remove
  }, [])
}

/** Extract the most meaningful error line(s) from dev server output */
function extractError(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const errorLines: string[] = []
  for (const line of lines) {
    if (/^\s*at\s/.test(line)) continue
    if (/^(npm|yarn|pnpm)\s(ERR|WARN)!/.test(line)) continue

    if (
      /error|Error|SyntaxError|TypeError|ReferenceError|Cannot find|Module not found|Unexpected|failed to compile|ENOENT|EACCES/i.test(
        line,
      )
    ) {
      errorLines.push(line)
    }
  }

  const result =
    errorLines.length > 0
      ? errorLines.slice(0, 3).join(' | ')
      : lines.slice(-3).join(' | ')

  return result.slice(0, 300) || 'unknown error'
}
