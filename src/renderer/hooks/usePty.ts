import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '@/stores/terminal'
import { useProjectStore } from '@/stores/project'
import { useTabsStore } from '@/stores/tabs'

interface ConnectOptions {
  autoLaunchClaude?: boolean
  /** Explicit tab ID to associate the PTY with. Required when tabs spawn concurrently. */
  tabId?: string
}

/**
 * Write a styled welcome banner to the terminal while the shell initializes.
 */
function writeWelcomeBanner(terminal: Terminal) {
  const c = '\x1b[36m'  // cyan
  const b = '\x1b[1m'   // bold
  const d = '\x1b[2m'   // dim
  const r = '\x1b[0m'   // reset

  const W = 44
  const pad = (text: string, ansiPrefix = '', ansiSuffix = r) => {
    const visible = text.length
    const padding = Math.max(0, W - visible)
    return `${c}\u2502${r} ${ansiPrefix}${text}${ansiSuffix}${' '.repeat(padding)}${c}\u2502${r}`
  }

  const lines = [
    '',
    `  ${c}\u256D${'\u2500'.repeat(W + 2)}\u256E${r}`,
    `  ${pad('')}`,
    `  ${pad('\u2726 Claude Canvas', b + c)}`,
    `  ${pad('Terminal-first dev environment', d)}`,
    `  ${pad('')}`,
    `  ${pad('Canvas tools available to Claude:', d)}`,
    `  ${pad('\u2022 Live preview & hot reload', d)}`,
    `  ${pad('\u2022 Component gallery', d)}`,
    `  ${pad('\u2022 Git timeline & visual diff', d)}`,
    `  ${pad('\u2022 Element inspector', d)}`,
    `  ${pad('')}`,
    `  ${pad('Launching Claude Code...', d)}`,
    `  ${pad('')}`,
    `  ${c}\u2570${'\u2500'.repeat(W + 2)}\u256F${r}`,
    '',
    '',
  ]

  terminal.write(lines.join('\r\n'))
}

/**
 * Wait for the MCP server to be ready, then return the port.
 */
function waitForMcpReady(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (useProjectStore.getState().mcpReady) {
      resolve()
      return
    }
    const unsub = useProjectStore.subscribe((state) => {
      if (state.mcpReady) {
        unsub()
        resolve()
      }
    })
    setTimeout(() => {
      unsub()
      resolve()
    }, timeoutMs)
  })
}

export function usePty() {
  const ptyIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const claudeLaunchedRef = useRef(false)
  const connectGenRef = useRef(0)
  const { setPtyId, setIsRunning } = useTerminalStore()

  const connect = useCallback(async (terminal: Terminal, cwd?: string, options?: ConnectOptions) => {
    const gen = ++connectGenRef.current

    // Use the explicitly provided tab ID (correct when multiple tabs spawn
    // concurrently), falling back to the active tab as a last resort.
    const targetTabId = options?.tabId || useTabsStore.getState().activeTabId
    console.log(`[TAB-DEBUG] usePty.connect: targetTabId=${targetTabId}, gen=${gen}`)

    if (options?.autoLaunchClaude) {
      writeWelcomeBanner(terminal)
      claudeLaunchedRef.current = false
    }

    const id = await window.api.pty.spawn(undefined, cwd)

    if (gen !== connectGenRef.current) {
      window.api.pty.kill(id)
      return
    }

    ptyIdRef.current = id
    setPtyId(id)

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

    setIsRunning(true)

    let settleTimer: ReturnType<typeof setTimeout> | null = null

    // Register MCP server via CLI, then launch Claude Code
    const launchClaude = async () => {
      if (ptyIdRef.current !== id || claudeLaunchedRef.current) return
      claudeLaunchedRef.current = true

      // Ensure output is no longer suppressed
      suppressOutput = false

      // Clear shell init noise (compdef errors, prompt, etc.)
      // then redraw the welcome banner cleanly
      terminal.reset()
      writeWelcomeBanner(terminal)

      // MCP server is already registered via writeGlobalClaudeJson in the main
      // process — no need for `claude mcp add` here. Running it concurrently
      // caused race conditions that corrupted ~/.claude.json (breaking auth).
      window.api.pty.write(id, 'clear; claude\r')

      // Mark Claude as launched for boot overlay (delay for CLI to render)
      setTimeout(() => {
        if (!targetTabId) return
        const t = useTabsStore.getState().tabs.find(tab => tab.id === targetTabId)
        if (t && !t.boot.claudeReady) {
          useTabsStore.getState().updateTab(targetTabId, {
            boot: { ...t.boot, claudeReady: true }
          })
        }
      }, 1500)
    }

    // Suppress shell init noise (compdef errors, prompts) until Claude launches
    let suppressOutput = !!options?.autoLaunchClaude

    // PTY output -> terminal
    const removeData = window.api.pty.onData(id, (data) => {
      if (!suppressOutput) {
        terminal.write(data)
      }

      if (!claudeLaunchedRef.current && options?.autoLaunchClaude) {
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(async () => {
          await waitForMcpReady()
          suppressOutput = false
          launchClaude()
        }, 300)
      }
    })

    const removeExit = window.api.pty.onExit(id, () => {
      setIsRunning(false)
      setPtyId(null)
      ptyIdRef.current = null
    })

    cleanupRef.current = [removeData, removeExit]
    cleanupRef.current.push(() => {
      if (settleTimer) clearTimeout(settleTimer)
    })

    if (options?.autoLaunchClaude) {
      const fallbackTimer = setTimeout(async () => {
        await waitForMcpReady()
        launchClaude()
      }, 3000)
      cleanupRef.current.push(() => clearTimeout(fallbackTimer))
    }

    const disposable = terminal.onData((data) => {
      window.api.pty.write(id, data)
    })
    cleanupRef.current.push(() => disposable.dispose())
  }, [setPtyId, setIsRunning])

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
