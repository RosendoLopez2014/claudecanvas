import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { useTabsStore } from '@/stores/tabs'

interface ConnectOptions {
  autoLaunchClaude?: boolean
  /** Explicit tab ID to associate the PTY with. Required when tabs spawn concurrently. */
  tabId?: string
}

/**
 * Wait for the MCP server to be ready on a specific tab, then return true.
 * Falls back to false after timeout so Claude still launches.
 */
function waitForMcpReady(tabId: string, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    const tab = useTabsStore.getState().tabs.find(t => t.id === tabId)
    if (tab?.mcpReady) { resolve(true); return }
    const unsub = useTabsStore.subscribe((state) => {
      const t = state.tabs.find(t => t.id === tabId)
      if (t?.mcpReady) { unsub(); resolve(true) }
    })
    setTimeout(() => {
      unsub()
      console.warn('[usePty] MCP ready timeout — launching Claude without confirmed MCP')
      resolve(false)
    }, timeoutMs)
  })
}

export function usePty() {
  const ptyIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const claudeLaunchedRef = useRef(false)
  const connectGenRef = useRef(0)
  const connect = useCallback(async (terminal: Terminal, cwd?: string, options?: ConnectOptions) => {
    const gen = ++connectGenRef.current

    // Use the explicitly provided tab ID (correct when multiple tabs spawn
    // concurrently), falling back to the active tab as a last resort.
    const targetTabId = options?.tabId || useTabsStore.getState().activeTabId
    console.log(`[TAB-DEBUG] usePty.connect: targetTabId=${targetTabId}, gen=${gen}`)

    if (options?.autoLaunchClaude) {
      claudeLaunchedRef.current = false
    }

    const id = await window.api.pty.spawn(undefined, cwd)

    if (gen !== connectGenRef.current) {
      window.api.pty.kill(id)
      return
    }

    ptyIdRef.current = id

    // Store ptyId in the tab that owns this terminal
    if (targetTabId) {
      console.log(`[TAB-DEBUG] usePty.connect: assigning pty=${id} to tab=${targetTabId}`)
      const tab = useTabsStore.getState().tabs.find(t => t.id === targetTabId)
      if (tab) {
        useTabsStore.getState().updateTab(targetTabId, {
          ptyId: id,
          boot: { ...tab.boot, ptyReady: true }
        })
      }
    }

    let settleTimer: ReturnType<typeof setTimeout> | null = null

    // Register MCP server via CLI, then launch Claude Code
    let claudeOutputBytes = 0
    let claudeReadyFired = false

    const markClaudeReady = () => {
      if (claudeReadyFired || !targetTabId) return
      claudeReadyFired = true
      const t = useTabsStore.getState().tabs.find(tab => tab.id === targetTabId)
      if (t && !t.boot.claudeReady) {
        useTabsStore.getState().updateTab(targetTabId, {
          boot: { ...t.boot, claudeReady: true }
        })
      }
    }

    const launchClaude = async () => {
      if (ptyIdRef.current !== id || claudeLaunchedRef.current) return
      claudeLaunchedRef.current = true
      const tabState = targetTabId ? useTabsStore.getState().tabs.find(tab => tab.id === targetTabId) : null
      console.log(`[MCP-RENDERER] launchClaude: mcpReady=${tabState?.mcpReady ?? false}`)

      // MCP is confirmed ready (waitForMcpReady resolved before we get here).
      // Set per-tab flag so the boot overlay progresses even for tabs opened
      // after the shared MCP server was already started by the first tab.
      if (targetTabId) {
        const t = useTabsStore.getState().tabs.find(tab => tab.id === targetTabId)
        if (t && !t.boot.mcpReady) {
          useTabsStore.getState().updateTab(targetTabId, {
            boot: { ...t.boot, mcpReady: true }
          })
        }
      }

      // Ensure output is no longer suppressed
      suppressOutput = false

      // Clear shell init noise
      terminal.reset()

      window.api.pty.write(id, 'claude\r')

      // Fallback: if Claude output detection doesn't fire, dismiss after 10s
      const fallback = setTimeout(markClaudeReady, 10000)
      cleanupRef.current.push(() => clearTimeout(fallback))
    }

    // Suppress shell init noise (compdef errors, prompts) until Claude launches
    let suppressOutput = !!options?.autoLaunchClaude

    // PTY output -> terminal
    const removeData = window.api.pty.onData(id, (data) => {
      if (!suppressOutput) {
        terminal.write(data)
      }

      // Detect Claude CLI startup by tracking output volume after launch.
      // Claude's banner is 500+ chars of Unicode box-drawing and text.
      if (claudeLaunchedRef.current && !claudeReadyFired) {
        claudeOutputBytes += typeof data === 'string' ? data.length : 0
        if (claudeOutputBytes > 500) {
          markClaudeReady()
        }
      }

      if (!claudeLaunchedRef.current && options?.autoLaunchClaude) {
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(async () => {
          const ready = await waitForMcpReady(targetTabId!)
          if (!ready) console.warn('[usePty] MCP not confirmed ready at shell-settle launch')
          suppressOutput = false
          launchClaude()
        }, 300)
      }
    })

    const removeExit = window.api.pty.onExit(id, () => {
      ptyIdRef.current = null
    })

    cleanupRef.current = [removeData, removeExit]
    cleanupRef.current.push(() => {
      if (settleTimer) clearTimeout(settleTimer)
    })

    if (options?.autoLaunchClaude) {
      const fallbackTimer = setTimeout(async () => {
        const ready = await waitForMcpReady(targetTabId!)
        if (!ready) console.warn('[usePty] MCP not confirmed ready at fallback launch')
        launchClaude()
      }, 5000)
      cleanupRef.current.push(() => clearTimeout(fallbackTimer))
    }

    const disposable = terminal.onData((data) => {
      window.api.pty.write(id, data)
    })
    cleanupRef.current.push(() => disposable.dispose())
  }, [])

  const resize = useCallback((cols: number, rows: number) => {
    if (ptyIdRef.current) {
      window.api.pty.resize(ptyIdRef.current, cols, rows)
    }
  }, [])

  const write = useCallback((data: string) => {
    if (ptyIdRef.current) {
      window.api.pty.write(ptyIdRef.current, data)
    }
  }, [])

  useEffect(() => {
    return () => {
      console.log(`[TAB-DEBUG] usePty CLEANUP: ptyId=${ptyIdRef.current}`)
      cleanupRef.current.forEach((fn) => fn())
      cleanupRef.current = []
      if (ptyIdRef.current) {
        console.log(`[TAB-DEBUG] usePty KILLING PTY: ${ptyIdRef.current}`)
        window.api.pty.kill(ptyIdRef.current)
        ptyIdRef.current = null
      }
      claudeLaunchedRef.current = false
    }
  }, [])

  return { connect, resize, write, ptyId: ptyIdRef.current }
}
