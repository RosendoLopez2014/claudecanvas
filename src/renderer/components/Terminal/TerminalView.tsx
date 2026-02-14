import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { usePty } from '@/hooks/usePty'
import { useTerminalStore } from '@/stores/terminal'

interface TerminalViewProps {
  cwd?: string
  tabId?: string
  autoLaunchClaude?: boolean
}

export function TerminalView({ cwd, tabId, autoLaunchClaude = true }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const { connect, resize } = usePty()
  const initializedRef = useRef(false)

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    initializedRef.current = true

    const terminal = new Terminal({
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
      cursorStyle: 'bar'
    })

    terminalRef.current = terminal

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new Unicode11Addon())
    terminal.loadAddon(new SearchAddon())

    terminal.open(containerRef.current)

    // Load WebGL addon after terminal is open
    try {
      terminal.loadAddon(new WebglAddon())
    } catch {
      console.warn('WebGL addon failed to load, using canvas renderer')
    }

    fitAddon.fit()

    // Spawn PTY now that terminal is ready
    connect(terminal, cwd, { autoLaunchClaude })

    // Expose focus function so other components can focus the terminal
    useTerminalStore.getState().setFocusFn(() => terminal.focus())

    return () => {
      useTerminalStore.getState().setFocusFn(null)
      terminal.dispose()
      terminalRef.current = null
      initializedRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle resize — debounced so the terminal only re-fits AFTER
  // the canvas animation completes, not on every intermediate frame.
  // Uses 320ms debounce to match the 300ms CSS transition.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const doFit = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
        resize(terminalRef.current.cols, terminalRef.current.rows)
      }
    }

    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        doFit()
      }, 320)
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [resize])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '8px 0 0 8px' }}
    />
  )
}
