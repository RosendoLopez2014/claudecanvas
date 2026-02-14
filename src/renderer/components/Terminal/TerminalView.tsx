import { useEffect, useRef } from 'react'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { usePty } from '@/hooks/usePty'
import { useTerminalStore } from '@/stores/terminal'
import {
  getOrCreateTerminal,
  setTerminalContainer,
  showTerminal
} from '@/services/terminalPool'

const TERMINAL_OPTIONS = {
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: 13,
  lineHeight: 1.4,
  letterSpacing: 0,
  theme: {
    background: '#0A0F1A',
    foreground: '#C8D6E5',
    cursor: '#4AEAFF',
    cursorAccent: '#0A0F1A',
    selectionBackground: 'rgba(74, 234, 255, 0.2)',
    selectionForeground: '#FFFFFF',
    black: '#1a1e2e',
    red: '#FF6B4A',
    green: '#4ADE80',
    yellow: '#FACC15',
    blue: '#60A5FA',
    magenta: '#C084FC',
    cyan: '#4AEAFF',
    white: '#C8D6E5',
    brightBlack: '#4B5563',
    brightRed: '#FF8A6A',
    brightGreen: '#6EE7A0',
    brightYellow: '#FDE047',
    brightBlue: '#93C5FD',
    brightMagenta: '#D8B4FE',
    brightCyan: '#7EEDFF',
    brightWhite: '#F9FAFB'
  },
  allowProposedApi: true,
  scrollback: 10000,
  cursorBlink: true,
  cursorStyle: 'bar' as const
}

interface TerminalViewProps {
  cwd?: string
  tabId?: string
  autoLaunchClaude?: boolean
}

export function TerminalView({ cwd, tabId, autoLaunchClaude = true }: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fitAddons = useRef(new Map<string, FitAddon>())
  const initializedTabs = useRef(new Set<string>())
  const { connect, resize } = usePty()

  // Initialize terminal for current tabId
  useEffect(() => {
    if (!wrapperRef.current || !tabId) return

    if (!initializedTabs.current.has(tabId)) {
      initializedTabs.current.add(tabId)

      // Create a dedicated container div for this tab's terminal
      const container = document.createElement('div')
      container.style.width = '100%'
      container.style.height = '100%'
      container.style.padding = '8px 0 0 8px'
      wrapperRef.current.appendChild(container)

      const terminal = getOrCreateTerminal(tabId, TERMINAL_OPTIONS)
      setTerminalContainer(tabId, container)

      const fitAddon = new FitAddon()
      fitAddons.current.set(tabId, fitAddon)

      terminal.loadAddon(fitAddon)
      terminal.loadAddon(new Unicode11Addon())
      terminal.loadAddon(new SearchAddon())

      terminal.open(container)

      // Load WebGL addon after terminal is open
      try {
        terminal.loadAddon(new WebglAddon())
      } catch {
        console.warn('WebGL addon failed to load, using canvas renderer')
      }

      fitAddon.fit()

      // Spawn PTY now that terminal is ready
      connect(terminal, cwd, { autoLaunchClaude })

      // Expose focus function for the active terminal
      useTerminalStore.getState().setFocusFn(() => terminal.focus())
    }

    // Show this tab's terminal, hide others
    showTerminal(tabId)

    // Update focus function to point to the now-active terminal
    const activeTerminal = getOrCreateTerminal(tabId, TERMINAL_OPTIONS)
    useTerminalStore.getState().setFocusFn(() => activeTerminal.focus())

    // Re-fit the active terminal after display change
    const fitAddon = fitAddons.current.get(tabId)
    if (fitAddon) {
      setTimeout(() => fitAddon.fit(), 50)
    }
  }, [tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle resize -- debounced so the terminal only re-fits AFTER
  // the canvas animation completes, not on every intermediate frame.
  // Uses 320ms debounce to match the 300ms CSS transition.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!tabId) return
        const fitAddon = fitAddons.current.get(tabId)
        const terminal = getOrCreateTerminal(tabId, TERMINAL_OPTIONS)
        if (fitAddon && terminal) {
          fitAddon.fit()
          resize(terminal.cols, terminal.rows)
        }
      }, 320)
    })

    if (wrapperRef.current) {
      observer.observe(wrapperRef.current)
    }

    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [tabId, resize])

  return <div ref={wrapperRef} className="w-full h-full relative" />
}
