import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search } from 'lucide-react'

interface Shortcut {
  keys: string
  label: string
  category: string
}

const SHORTCUTS: Shortcut[] = [
  // Terminal
  { keys: '⌘T', label: 'New tab', category: 'Terminal' },
  { keys: '⌘W', label: 'Close tab', category: 'Terminal' },
  { keys: '⌘1-9', label: 'Switch to tab N', category: 'Terminal' },
  { keys: '⌘⇧[', label: 'Previous tab', category: 'Terminal' },
  { keys: '⌘⇧]', label: 'Next tab', category: 'Terminal' },
  { keys: '⌘D', label: 'Split terminal', category: 'Terminal' },

  // Canvas
  { keys: '⌘B', label: 'Toggle file explorer', category: 'Canvas' },
  { keys: '⌘\\', label: 'Toggle canvas panel', category: 'Canvas' },
  { keys: '⌘I', label: 'Toggle inspector', category: 'Canvas' },
  { keys: '⌘G', label: 'Open gallery', category: 'Canvas' },

  // Git
  { keys: '⌘S', label: 'Create checkpoint', category: 'Git' },
  { keys: '⌘⇧P', label: 'Push to remote', category: 'Git' },

  // Navigation
  { keys: '⌘⇧F', label: 'Search in project', category: 'Navigation' },
  { keys: '⌘K', label: 'Quick actions', category: 'Navigation' },
  { keys: '⌘?', label: 'Keyboard shortcuts', category: 'Navigation' },
  { keys: '⌘,', label: 'Settings', category: 'Navigation' },

  // Window
  { keys: '⌘⇧F', label: 'Toggle fullscreen', category: 'Window' },
  { keys: '⌘M', label: 'Minimize', category: 'Window' },
]

interface ShortcutSheetProps {
  open: boolean
  onClose: () => void
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return SHORTCUTS
    const q = search.toLowerCase()
    return SHORTCUTS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    )
  }, [search])

  const grouped = useMemo(() => {
    const groups: Record<string, Shortcut[]> = {}
    for (const s of filtered) {
      if (!groups[s.category]) groups[s.category] = []
      groups[s.category].push(s)
    }
    return groups
  }, [filtered])

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
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-[480px] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-sm font-medium text-white/80">Keyboard Shortcuts</span>
              <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition">
                <X size={14} className="text-white/40" />
              </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
              <Search size={12} className="text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search shortcuts..."
                autoFocus
                className="flex-1 bg-transparent text-xs text-white placeholder-white/30 outline-none"
              />
            </div>

            {/* Shortcuts */}
            <div className="max-h-[400px] overflow-auto py-2">
              {Object.entries(grouped).map(([category, shortcuts]) => (
                <div key={category} className="mb-3">
                  <div className="px-4 py-1 text-[10px] text-white/25 uppercase tracking-wider font-semibold">
                    {category}
                  </div>
                  {shortcuts.map((s) => (
                    <div key={s.keys + s.label} className="flex items-center justify-between px-4 py-1.5 hover:bg-white/5 transition">
                      <span className="text-xs text-white/60">{s.label}</span>
                      <kbd className="text-[11px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                        {s.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-white/30">No matching shortcuts</div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
