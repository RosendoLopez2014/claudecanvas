import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '@/stores/terminal'

export function usePty() {
  const ptyIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const { setPtyId, setIsRunning } = useTerminalStore()

  const connect = useCallback(async (terminal: Terminal, cwd?: string) => {
    // Avoid double-spawning
    if (ptyIdRef.current) return

    const id = await window.api.pty.spawn()
    ptyIdRef.current = id
    setPtyId(id)
    setIsRunning(true)

    // PTY output -> terminal
    const removeData = window.api.pty.onData(id, (data) => {
      terminal.write(data)
    })

    const removeExit = window.api.pty.onExit(id, () => {
      setIsRunning(false)
      setPtyId(null)
      ptyIdRef.current = null
    })

    cleanupRef.current = [removeData, removeExit]

    // Terminal input -> PTY
    const disposable = terminal.onData((data) => {
      window.api.pty.write(id, data)
    })
    cleanupRef.current.push(() => disposable.dispose())

    // Set working directory if provided
    if (cwd) {
      window.api.pty.setCwd(id, cwd)
    }
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current.forEach((fn) => fn())
      if (ptyIdRef.current) {
        window.api.pty.kill(ptyIdRef.current)
      }
    }
  }, [])

  return { connect, resize, write, ptyId: ptyIdRef.current }
}
