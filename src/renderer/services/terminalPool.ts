import { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'

interface PoolEntry {
  terminal: Terminal
  container: HTMLDivElement | null
  searchAddon: SearchAddon | null
}

const pool = new Map<string, PoolEntry>()

/**
 * Returns a pooled terminal or creates a fresh one.
 * If the existing terminal is stale (its container was detached from the DOM),
 * it's disposed and a new one is created. This prevents blank terminals if
 * something unexpected triggers a teardown.
 */
export function getOrCreateTerminal(
  tabId: string,
  options: Record<string, unknown>
): Terminal {
  const existing = pool.get(tabId)
  if (existing) {
    // Detect stale terminal: container exists but is no longer in the DOM
    const isStale = existing.container && !existing.container.isConnected
    if (!isStale) return existing.terminal

    // Stale — dispose and recreate
    console.warn(`[terminalPool] Stale terminal detected for ${tabId}, recreating`)
    existing.terminal.dispose()
    pool.delete(tabId)
  }
  const terminal = new Terminal(options as ConstructorParameters<typeof Terminal>[0])
  pool.set(tabId, { terminal, container: null, searchAddon: null })
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

export function destroyTerminal(poolKey: string): void {
  const entry = pool.get(poolKey)
  if (entry) {
    entry.terminal.dispose()
    if (entry.container?.parentElement) {
      entry.container.parentElement.removeChild(entry.container)
    }
    pool.delete(poolKey)
  }
}

/**
 * Destroy all pooled terminals belonging to a tab (matches any pool key
 * starting with `${tabId}:`). Use this when closing a tab to clean up
 * all terminal instances and splits.
 */
export function destroyTerminalsForTab(tabId: string): void {
  for (const [key, entry] of pool) {
    if (key === tabId || key.startsWith(`${tabId}:`)) {
      entry.terminal.dispose()
      if (entry.container?.parentElement) {
        entry.container.parentElement.removeChild(entry.container)
      }
      pool.delete(key)
    }
  }
}

export function setSearchAddon(tabId: string, addon: SearchAddon): void {
  const entry = pool.get(tabId)
  if (entry) entry.searchAddon = addon
}

export function getSearchAddon(tabId: string): SearchAddon | null {
  return pool.get(tabId)?.searchAddon || null
}

export function getTerminal(tabId: string): Terminal | null {
  return pool.get(tabId)?.terminal || null
}

export function hasTerminal(tabId: string): boolean {
  return pool.has(tabId)
}
