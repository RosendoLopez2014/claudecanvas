import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, Terminal, Server, X, Loader2 } from 'lucide-react'
import { useActiveTab } from '@/stores/tabs'

interface ProcessInfo {
  pid: number
  type: 'pty' | 'devserver'
  label: string
  cwd: string
  startedAt: number
  tabId?: string
  cpu?: number
  memory?: number
}

function formatUptime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatMemory(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${Math.round(bytes / (1024 * 1024))}M`
}

export function ProcessManager() {
  const [open, setOpen] = useState(false)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [killing, setKilling] = useState<Set<number>>(new Set())
  const popoverRef = useRef<HTMLDivElement>(null)
  const tab = useActiveTab()

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.process.list({ tabId: tab?.id })
      setProcesses(list)
    } catch {
      setProcesses([])
    }
  }, [tab?.id])

  // Refresh on open and every 3 seconds while open
  useEffect(() => {
    if (!open) return
    refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [open, refresh])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleKill = useCallback(async (pid: number) => {
    setKilling((prev) => new Set(prev).add(pid))
    try {
      await window.api.process.kill({ pid })
      // Refresh after a short delay to let process exit
      setTimeout(refresh, 500)
    } catch {}
    setKilling((prev) => {
      const next = new Set(prev)
      next.delete(pid)
      return next
    })
  }, [refresh])

  const count = processes.length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-white/30 hover:text-white/60 transition-colors rounded"
        title="Process manager"
      >
        <Activity size={11} />
        {count > 0 && (
          <span className="text-[9px] tabular-nums">{count}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full mb-2 right-0 w-80 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[200] overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
              <span className="text-[11px] text-white/50 font-medium">Processes</span>
              <span className="text-[9px] text-white/20">{count} active</span>
            </div>

            {processes.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-white/20">
                No active processes
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto">
                {processes.map((proc) => (
                  <div
                    key={proc.pid}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors group"
                  >
                    {/* Type icon */}
                    <div className="text-white/20 shrink-0">
                      {proc.type === 'pty' ? <Terminal size={12} /> : <Server size={12} />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white/60 truncate">{proc.label}</div>
                      <div className="flex items-center gap-2 text-[9px] text-white/20">
                        <span>PID {proc.pid}</span>
                        <span>{formatUptime(proc.startedAt)}</span>
                        {proc.cpu !== undefined && <span>{proc.cpu}%</span>}
                        <span>{formatMemory(proc.memory)}</span>
                      </div>
                    </div>

                    {/* Kill button */}
                    <button
                      onClick={() => handleKill(proc.pid)}
                      disabled={killing.has(proc.pid)}
                      className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-white/20 hover:text-red-400 transition-all disabled:opacity-50"
                      title="Kill process"
                    >
                      {killing.has(proc.pid) ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <X size={10} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
