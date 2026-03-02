import pidusage from 'pidusage'

export interface ProcessInfo {
  pid: number
  type: 'pty' | 'devserver'
  label: string
  cwd: string
  startedAt: number
  tabId?: string
  cpu?: number     // percentage
  memory?: number  // RSS bytes
}

type PtyProvider = () => Array<{ pid: number; id: string; cwd: string; startedAt: number; tabId?: string }>
type DevProvider = () => Array<{ pid: number; cwd: string; url: string | null; startedAt: number }>

let ptyProvider: PtyProvider | null = null
let devProvider: DevProvider | null = null

export function registerPtyProvider(provider: PtyProvider): void {
  ptyProvider = provider
}

export function registerDevProvider(provider: DevProvider): void {
  devProvider = provider
}

export async function listProcesses(tabId?: string): Promise<ProcessInfo[]> {
  const result: ProcessInfo[] = []

  // Gather PTY processes
  if (ptyProvider) {
    for (const pty of ptyProvider()) {
      if (tabId && pty.tabId !== tabId) continue
      result.push({
        pid: pty.pid,
        type: 'pty',
        label: `Terminal (${pty.id.slice(0, 8)})`,
        cwd: pty.cwd,
        startedAt: pty.startedAt,
        tabId: pty.tabId,
      })
    }
  }

  // Gather dev server processes
  if (devProvider) {
    for (const dev of devProvider()) {
      result.push({
        pid: dev.pid,
        type: 'devserver',
        label: dev.url ? `Dev Server (${dev.url})` : 'Dev Server',
        cwd: dev.cwd,
        startedAt: dev.startedAt,
      })
    }
  }

  // Enrich with CPU/memory stats
  const pids = result.map((p) => p.pid).filter(Boolean)
  if (pids.length > 0) {
    try {
      const stats = await pidusage(pids)
      for (const proc of result) {
        const s = stats[proc.pid]
        if (s) {
          proc.cpu = Math.round(s.cpu * 10) / 10
          proc.memory = s.memory
        }
      }
    } catch {
      // pidusage can fail for zombie/exited processes — ignore
    }
  }

  return result
}
