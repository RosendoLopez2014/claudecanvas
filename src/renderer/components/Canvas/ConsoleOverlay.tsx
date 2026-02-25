import type { ConsoleLogEntry } from '@/types/canvas'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'
import { useTerminalStore } from '@/stores/terminal'
import { useState, useCallback } from 'react'
import { Terminal, ChevronDown, ChevronUp, Trash2, Bug, Copy, Check } from 'lucide-react'

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

// Color-code known label prefixes (matches DevTools styling)
const LABEL_COLORS: Record<string, string> = {
  'Element:': 'text-cyan-400',
  'Class:': 'text-cyan-400',
  'ID:': 'text-cyan-400',
  'Text:': 'text-cyan-400',
  'Position:': 'text-pink-400',
  'Computed:': 'text-pink-400',
  'Parent:': 'text-lime-400',
  'Event:': 'text-lime-400',
}

function ColorizedMessage({ message, level }: { message: string; level: string }) {
  // Check if message starts with a known label
  for (const [label, color] of Object.entries(LABEL_COLORS)) {
    if (message.startsWith(label)) {
      return (
        <>
          <span className={`${color} font-semibold`}>{label}</span>
          <span className="text-white/70">{message.slice(label.length)}</span>
        </>
      )
    }
  }
  // Group headers (e.g. "🖱 Click Debug")
  if (message.includes('Click Debug') || message.includes('Debug')) {
    return <span className="text-purple-400 font-semibold">{message}</span>
  }
  return <span className={LEVEL_COLORS[level] || 'text-white/70'}>{message}</span>
}

function LogEntry({ entry }: { entry: ConsoleLogEntry }) {
  return (
    <div className={`flex items-start gap-2 px-3 py-1 text-[11px] font-mono border-b border-white/5 ${LEVEL_BG[entry.level] || ''}`}>
      <span className="text-white/20 shrink-0 select-none">{formatTime(entry.timestamp)}</span>
      <span className="whitespace-pre-wrap break-all">
        <ColorizedMessage message={entry.message} level={entry.level} />
      </span>
    </div>
  )
}

export function ConsoleOverlay() {
  const currentTab = useTabsStore(selectActiveTab)
  const consoleLogs = currentTab?.consoleLogs ?? []
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const errorCount = consoleLogs.filter((l) => l.level === 'error').length
  const warnCount = consoleLogs.filter((l) => l.level === 'warn').length

  // Copy all console logs to clipboard
  const copyLogs = useCallback(() => {
    if (consoleLogs.length === 0) return
    const text = consoleLogs
      .map((l) => `[${formatTime(l.timestamp)}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [consoleLogs])

  // Send errors to Claude terminal for debugging
  const sendErrorsToClaude = useCallback(() => {
    const errors = consoleLogs.filter((l) => l.level === 'error')
    if (errors.length === 0) return
    const store = useTerminalStore.getState()
    if (!store.ptyId) return
    const deduped = [...new Map(errors.map((e) => [e.message, e])).values()]
    const errText = deduped.map((e, i) => `${i + 1}. ${e.message}`).join('\n')
    const prompt = `Fix these ${deduped.length} runtime error${deduped.length > 1 ? 's' : ''} from the preview:\n\n${errText}\n\nFix each error, then call canvas_get_errors to verify — it auto-clears old errors so only NEW errors appear. If canvas_get_errors returns "no errors", you're done. `
    window.api.pty.write(store.ptyId, prompt)
    requestAnimationFrame(() => store.focus())
  }, [consoleLogs])

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
          {errorCount > 0 && <span className="text-red-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />{errorCount} {errorCount === 1 ? 'error' : 'errors'}</span>}
          {warnCount > 0 && <span className="text-yellow-400">{warnCount} {warnCount === 1 ? 'warning' : 'warnings'}</span>}
        </div>
        <div className="flex items-center gap-1">
          {expanded && errorCount > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); sendErrorsToClaude() }}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded cursor-pointer transition-colors"
              title="Send errors to Claude for debugging"
            >
              <Bug size={10} />
              <span className="text-[10px]">Fix with Claude</span>
            </span>
          )}
          {expanded && consoleLogs.length > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); copyLogs() }}
              className="p-0.5 hover:bg-white/10 rounded cursor-pointer"
              title="Copy logs to clipboard"
            >
              {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            </span>
          )}
          {expanded && (
            <span
              onClick={(e) => { e.stopPropagation(); const tab = useTabsStore.getState().getActiveTab(); if (tab) useTabsStore.getState().clearConsoleLogs(tab.id) }}
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
