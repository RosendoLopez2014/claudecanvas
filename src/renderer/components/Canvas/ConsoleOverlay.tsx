import { useCanvasStore, type ConsoleLogEntry } from '@/stores/canvas'
import { useState } from 'react'
import { Terminal, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

const LEVEL_COLORS: Record<string, string> = {
  log: 'text-white/70',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
}

const LEVEL_BG: Record<string, string> = {
  warn: 'bg-yellow-400/5',
  error: 'bg-red-400/5',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function LogEntry({ entry }: { entry: ConsoleLogEntry }) {
  return (
    <div className={`flex items-start gap-2 px-3 py-1 text-[11px] font-mono border-b border-white/5 ${LEVEL_BG[entry.level] || ''}`}>
      <span className="text-white/20 shrink-0 select-none">{formatTime(entry.timestamp)}</span>
      <span className={`${LEVEL_COLORS[entry.level] || 'text-white/70'} whitespace-pre-wrap break-all`}>
        {entry.message}
      </span>
    </div>
  )
}

export function ConsoleOverlay() {
  const consoleLogs = useCanvasStore((s) => s.consoleLogs)
  const clearConsoleLogs = useCanvasStore((s) => s.clearConsoleLogs)
  const [expanded, setExpanded] = useState(false)

  if (consoleLogs.length === 0 && !expanded) return null

  const errorCount = consoleLogs.filter((l) => l.level === 'error').length
  const warnCount = consoleLogs.filter((l) => l.level === 'warn').length

  return (
    <div className={`absolute bottom-0 left-0 right-0 z-30 bg-[var(--bg-primary)] border-t border-white/10 transition-all ${expanded ? 'max-h-[40%]' : 'max-h-7'}`}>
      {/* Header bar - always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full h-7 flex items-center justify-between px-3 text-[11px] text-white/50 hover:text-white/70 transition-colors bg-[var(--bg-secondary)]"
      >
        <div className="flex items-center gap-2">
          <Terminal size={11} />
          <span>Console</span>
          <span className="text-white/20">({consoleLogs.length})</span>
          {errorCount > 0 && <span className="text-red-400">{errorCount} errors</span>}
          {warnCount > 0 && <span className="text-yellow-400">{warnCount} warnings</span>}
        </div>
        <div className="flex items-center gap-1">
          {expanded && (
            <span
              onClick={(e) => { e.stopPropagation(); clearConsoleLogs() }}
              className="p-0.5 hover:bg-white/10 rounded cursor-pointer"
              title="Clear console"
            >
              <Trash2 size={10} />
            </span>
          )}
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </div>
      </button>

      {/* Log entries */}
      {expanded && (
        <div className="overflow-y-auto max-h-[calc(40vh-28px)]">
          {consoleLogs.length === 0 ? (
            <div className="p-3 text-[11px] text-white/20 text-center">No console output</div>
          ) : (
            consoleLogs.map((entry, i) => <LogEntry key={i} entry={entry} />)
          )}
        </div>
      )}
    </div>
  )
}
