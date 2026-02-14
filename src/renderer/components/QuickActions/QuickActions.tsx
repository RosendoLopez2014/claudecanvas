import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye,
  Image,
  Clock,
  ArrowLeftRight,
  PanelRight,
  Save,
  Command
} from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'

interface QuickAction {
  id: string
  label: string
  shortcut?: string
  icon: typeof Eye
  action: () => void
}

interface QuickActionsProps {
  open: boolean
  onClose: () => void
}

export function QuickActions({ open, onClose }: QuickActionsProps) {
  const [search, setSearch] = useState('')
  const { inspectorActive, setInspectorActive, setActiveTab } = useCanvasStore()
  const { mode, openCanvas, closeCanvas } = useWorkspaceStore()

  const actions: QuickAction[] = useMemo(
    () => [
      {
        id: 'toggle-inspector',
        label: inspectorActive ? 'Deactivate Inspector' : 'Activate Inspector',
        shortcut: 'Cmd+I',
        icon: Eye,
        action: () => {
          setInspectorActive(!inspectorActive)
          onClose()
        }
      },
      {
        id: 'open-gallery',
        label: 'Open Gallery',
        shortcut: 'Cmd+G',
        icon: Image,
        action: () => {
          if (mode !== 'terminal-canvas') openCanvas()
          setActiveTab('gallery')
          onClose()
        }
      },
      {
        id: 'open-timeline',
        label: 'Open Timeline',
        shortcut: 'Cmd+T',
        icon: Clock,
        action: () => {
          if (mode !== 'terminal-canvas') openCanvas()
          setActiveTab('timeline')
          onClose()
        }
      },
      {
        id: 'open-diff',
        label: 'Open Diff View',
        icon: ArrowLeftRight,
        action: () => {
          if (mode !== 'terminal-canvas') openCanvas()
          setActiveTab('diff')
          onClose()
        }
      },
      {
        id: 'toggle-canvas',
        label: mode === 'terminal-canvas' ? 'Close Canvas Panel' : 'Open Canvas Panel',
        shortcut: 'Cmd+\\',
        icon: PanelRight,
        action: () => {
          mode === 'terminal-canvas' ? closeCanvas() : openCanvas()
          onClose()
        }
      },
      {
        id: 'create-checkpoint',
        label: 'Create Checkpoint',
        icon: Save,
        action: async () => {
          const projectPath = useProjectStore.getState().currentProject?.path
          if (!projectPath) return
          const message = `Checkpoint at ${new Date().toLocaleTimeString()}`
          await window.api.git.checkpoint(projectPath, message)
          onClose()
        }
      }
    ],
    [inspectorActive, setInspectorActive, mode, openCanvas, closeCanvas, setActiveTab, onClose]
  )

  const filtered = useMemo(() => {
    if (!search) return actions
    const q = search.toLowerCase()
    return actions.filter((a) => a.label.toLowerCase().includes(q))
  }, [actions, search])

  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
    setSearch('')
  }, [open])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        filtered[selectedIndex].action()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [filtered, selectedIndex, onClose]
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[480px] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Search */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
              <Command size={14} className="text-white/30" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-white placeholder-white/30 focus:outline-none"
              />
            </div>

            {/* Actions */}
            <div className="max-h-[300px] overflow-auto py-1">
              {filtered.map((action, i) => (
                <button
                  key={action.id}
                  onClick={action.action}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIndex ? 'bg-white/5' : ''
                  }`}
                >
                  <action.icon
                    size={14}
                    className={i === selectedIndex ? 'text-[var(--accent-cyan)]' : 'text-white/40'}
                  />
                  <span className="flex-1 text-sm text-white/80">{action.label}</span>
                  {action.shortcut && (
                    <span className="text-[10px] text-white/30 font-mono">{action.shortcut}</span>
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-white/30">No matching actions</div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
