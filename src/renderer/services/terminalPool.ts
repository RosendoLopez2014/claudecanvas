import { Terminal } from '@xterm/xterm'

interface PoolEntry {
  terminal: Terminal
  container: HTMLDivElement | null
}

const pool = new Map<string, PoolEntry>()

export function getOrCreateTerminal(
  tabId: string,
  options: Record<string, unknown>
): Terminal {
  if (pool.has(tabId)) return pool.get(tabId)!.terminal
  const terminal = new Terminal(options as ConstructorParameters<typeof Terminal>[0])
  pool.set(tabId, { terminal, container: null })
  return terminal
}

export function setTerminalContainer(tabId: string, container: HTMLDivElement): void {
  const entry = pool.get(tabId)
  if (!entry) return
  entry.container = container
}

export function showTerminal(tabId: string): void {
  for (const [id, entry] of pool) {
    if (entry.container) {
      entry.container.style.display = id === tabId ? 'block' : 'none'
    }
  }
}

export function destroyTerminal(tabId: string): void {
  const entry = pool.get(tabId)
  if (entry) {
    entry.terminal.dispose()
    if (entry.container?.parentElement) {
      entry.container.parentElement.removeChild(entry.container)
    }
    pool.delete(tabId)
  }
}

export function getTerminal(tabId: string): Terminal | null {
  return pool.get(tabId)?.terminal || null
}

export function hasTerminal(tabId: string): boolean {
  return pool.has(tabId)
}
