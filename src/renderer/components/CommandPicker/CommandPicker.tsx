import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Play, Zap, X } from 'lucide-react'

interface CommandPickerProps {
  open: boolean
  onClose: () => void
  /** Called when the user selects a command. `remember` = persist for this project. */
  onSelect: (command: string, remember: boolean) => void
  /** Pre-populated suggestions from framework detection. */
  suggestions: string[]
  /** Framework name for display (e.g. "Next.js", "Vite"). Null if unknown. */
  framework: string | null
  projectName: string
}

export function CommandPicker({
  open,
  onClose,
  onSelect,
  suggestions,
  framework,
  projectName,
}: CommandPickerProps) {
  const [customCommand, setCustomCommand] = useState('')
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    if (open) {
      setCustomCommand('')
      setRemember(true)
    }
  }, [open])

  const handleSelect = useCallback(
    (cmd: string) => {
      if (cmd.trim()) onSelect(cmd.trim(), remember)
    },
    [onSelect, remember]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && customCommand.trim()) {
        handleSelect(customCommand)
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [customCommand, handleSelect, onClose]
  )

  // Dedupe suggestions
  const uniqueSuggestions = useMemo(
    () => [...new Set(suggestions)],
    [suggestions]
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[440px] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-[var(--accent-cyan)]" />
                <span className="text-sm font-medium text-white/80">
                  How do you start <span className="text-[var(--accent-cyan)]">{projectName}</span>?
                </span>
              </div>
              <button
                onClick={onClose}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Framework badge */}
            {framework && (
              <div className="px-4 pt-3">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded text-[10px] text-white/40">
                  <Zap size={10} />
                  Detected: {framework}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {uniqueSuggestions.length > 0 && (
              <div className="px-4 pt-3 space-y-1.5">
                <div className="text-[10px] text-white/25 uppercase tracking-wider font-semibold">
                  Suggestions
                </div>
                {uniqueSuggestions.map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => handleSelect(cmd)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/5 hover:border-[var(--accent-cyan)]/30 bg-[var(--bg-tertiary)] transition-colors text-left group"
                  >
                    <Play
                      size={12}
                      className="text-white/30 group-hover:text-[var(--accent-cyan)] transition-colors fill-current"
                    />
                    <code className="text-sm text-white/70 font-mono group-hover:text-white transition-colors">
                      {cmd}
                    </code>
                  </button>
                ))}
              </div>
            )}

            {/* Custom command input */}
            <div className="px-4 pt-3 pb-2">
              <div className="text-[10px] text-white/25 uppercase tracking-wider font-semibold mb-1.5">
                {uniqueSuggestions.length > 0 ? 'Or enter a custom command' : 'Enter the dev command'}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. npm run dev"
                  autoFocus={uniqueSuggestions.length === 0}
                  className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg text-sm text-white font-mono placeholder-white/20 focus:outline-none focus:border-[var(--accent-cyan)]/50"
                />
                <button
                  onClick={() => handleSelect(customCommand)}
                  disabled={!customCommand.trim()}
                  className="px-3 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Run
                </button>
              </div>
            </div>

            {/* Remember toggle */}
            <div className="px-4 py-3 border-t border-white/5 flex items-center gap-2">
              <button
                onClick={() => setRemember((r) => !r)}
                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                  remember
                    ? 'bg-[var(--accent-cyan)] border-[var(--accent-cyan)]'
                    : 'border-white/20 hover:border-white/40'
                }`}
              >
                {remember && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span className="text-xs text-white/40">Remember for this project</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
