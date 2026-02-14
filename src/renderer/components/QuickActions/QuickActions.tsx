import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, Image, Clock, ArrowLeftRight, PanelRight, Save, Command,
  Play, Square, RotateCw, GitBranch, ArrowUp, ArrowDown, Camera,
  FolderOpen, Settings, Search, Terminal, Rocket, Zap, Keyboard,
  Monitor, Trash2
} from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useTabsStore } from '@/stores/tabs'

interface QuickAction {
  id: string
  label: string
  category: string
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
  const { inspectorActive, setInspectorActive, setActiveTab, setScreenshotMode, clearPreviewErrors, clearConsoleLogs } = useCanvasStore()
  const { mode, openCanvas, closeCanvas } = useWorkspaceStore()
  const { currentProject, isDevServerRunning } = useProjectStore()

  const actions: QuickAction[] = useMemo(
    () => [
      // ── Dev ──
      {
        id: 'start-server',
        label: 'Start Dev Server',
        category: 'Dev',
        icon: Play,
        action: async () => {
          if (!currentProject?.path || isDevServerRunning) return
          await window.api.dev.start(currentProject.path, currentProject.devCommand)
          onClose()
        }
      },
      {
        id: 'stop-server',
        label: 'Stop Dev Server',
        category: 'Dev',
        icon: Square,
        action: async () => {
          await window.api.dev.stop(currentProject?.path)
          onClose()
        }
      },
      {
        id: 'restart-server',
        label: 'Restart Dev Server',
        category: 'Dev',
        icon: RotateCw,
        action: async () => {
          if (!currentProject?.path) return
          await window.api.dev.stop(currentProject.path)
          await window.api.dev.start(currentProject.path, currentProject.devCommand)
          onClose()
        }
      },

      // ── Canvas ──
      {
        id: 'toggle-canvas',
        label: mode === 'terminal-canvas' ? 'Close Canvas Panel' : 'Open Canvas Panel',
        category: 'Canvas',
        shortcut: '⌘\\',
        icon: PanelRight,
        action: () => { mode === 'terminal-canvas' ? closeCanvas() : openCanvas(); onClose() }
      },
      {
        id: 'toggle-inspector',
        label: inspectorActive ? 'Deactivate Inspector' : 'Activate Inspector',
        category: 'Canvas',
        shortcut: '⌘I',
        icon: Eye,
        action: () => { setInspectorActive(!inspectorActive); onClose() }
      },
      {
        id: 'screenshot',
        label: 'Capture Screenshot',
        category: 'Canvas',
        icon: Camera,
        action: () => { setScreenshotMode(true); openCanvas(); setActiveTab('preview'); onClose() }
      },
      {
        id: 'open-gallery',
        label: 'Open Gallery',
        category: 'Canvas',
        icon: Image,
        action: () => { if (mode !== 'terminal-canvas') openCanvas(); setActiveTab('gallery'); onClose() }
      },
      {
        id: 'open-timeline',
        label: 'Open Timeline',
        category: 'Canvas',
        icon: Clock,
        action: () => { if (mode !== 'terminal-canvas') openCanvas(); setActiveTab('timeline'); onClose() }
      },
      {
        id: 'open-diff',
        label: 'Open Diff View',
        category: 'Canvas',
        icon: ArrowLeftRight,
        action: () => { if (mode !== 'terminal-canvas') openCanvas(); setActiveTab('diff'); onClose() }
      },
      {
        id: 'viewport-responsive',
        label: 'Set Viewport: Responsive',
        category: 'Canvas',
        icon: Monitor,
        action: () => {
          const tab = useTabsStore.getState().getActiveTab()
          if (tab) useTabsStore.getState().updateTab(tab.id, { viewportWidth: 0 })
          onClose()
        }
      },
      {
        id: 'viewport-mobile',
        label: 'Set Viewport: iPhone 14',
        category: 'Canvas',
        icon: Monitor,
        action: () => {
          const tab = useTabsStore.getState().getActiveTab()
          if (tab) useTabsStore.getState().updateTab(tab.id, { viewportWidth: 390 })
          onClose()
        }
      },
      {
        id: 'clear-errors',
        label: 'Clear Preview Errors',
        category: 'Canvas',
        icon: Trash2,
        action: () => { clearPreviewErrors(); onClose() }
      },
      {
        id: 'clear-console',
        label: 'Clear Console Logs',
        category: 'Canvas',
        icon: Trash2,
        action: () => { clearConsoleLogs(); onClose() }
      },

      // ── Git ──
      {
        id: 'create-checkpoint',
        label: 'Create Checkpoint',
        category: 'Git',
        icon: Save,
        action: async () => {
          const projectPath = currentProject?.path
          if (!projectPath) return
          const message = `Checkpoint at ${new Date().toLocaleTimeString()}`
          const result = await window.api.git.checkpoint(projectPath, message)
          if (result?.hash) {
            useToastStore.getState().addToast('Checkpoint created', 'success')
          }
          onClose()
        }
      },
      {
        id: 'git-push',
        label: 'Push to Remote',
        category: 'Git',
        icon: ArrowUp,
        action: async () => {
          const projectPath = currentProject?.path
          if (!projectPath) return
          const msg = await window.api.git.generateCommitMessage(projectPath)
          const result = await window.api.git.squashAndPush(projectPath, msg)
          if (result.success) {
            useToastStore.getState().addToast(`Pushed to ${(result as any).branch}`, 'success')
          } else {
            useToastStore.getState().addToast(`Push failed: ${(result as any).error}`, 'error')
          }
          onClose()
        }
      },
      {
        id: 'git-pull',
        label: 'Pull from Remote',
        category: 'Git',
        icon: ArrowDown,
        action: async () => {
          const projectPath = currentProject?.path
          if (!projectPath) return
          const result = await window.api.git.pull(projectPath)
          if (result.success) {
            useToastStore.getState().addToast('Pulled latest changes', 'success')
          } else {
            useToastStore.getState().addToast(`Pull failed: ${result.error}`, 'error')
          }
          onClose()
        }
      },
      {
        id: 'git-branch',
        label: 'View Branches',
        category: 'Git',
        icon: GitBranch,
        action: async () => {
          const projectPath = currentProject?.path
          if (!projectPath) return
          const info = await window.api.git.branch(projectPath)
          useToastStore.getState().addToast(`Branch: ${info.current}`, 'info')
          onClose()
        }
      },

      // ── Project ──
      {
        id: 'switch-project',
        label: 'Switch Project',
        category: 'Project',
        icon: FolderOpen,
        action: () => { useProjectStore.getState().setScreen('project-picker'); onClose() }
      },
      {
        id: 'new-tab',
        label: 'New Tab',
        category: 'Project',
        shortcut: '⌘T',
        icon: Terminal,
        action: () => { onClose() }  // Handled by keyboard shortcut system
      },

      // ── Deploy ──
      {
        id: 'deploy-vercel',
        label: 'Deploy to Vercel',
        category: 'Deploy',
        icon: Rocket,
        action: async () => {
          const projectPath = currentProject?.path
          if (!projectPath) return
          useToastStore.getState().addToast('Deploying...', 'info')
          onClose()
        }
      },

      // ── Tools ──
      {
        id: 'keyboard-shortcuts',
        label: 'Keyboard Shortcuts',
        category: 'Tools',
        shortcut: '⌘?',
        icon: Keyboard,
        action: () => { onClose() }
      },
      {
        id: 'settings',
        label: 'Settings',
        category: 'Tools',
        shortcut: '⌘,',
        icon: Settings,
        action: () => { onClose(); window.dispatchEvent(new CustomEvent('open-settings')) }
      },
      {
        id: 'token-usage',
        label: 'View Token Usage',
        category: 'Tools',
        icon: Zap,
        action: () => { onClose() }
      },
    ],
    [inspectorActive, setInspectorActive, mode, openCanvas, closeCanvas, setActiveTab,
     setScreenshotMode, clearPreviewErrors, clearConsoleLogs, currentProject,
     isDevServerRunning, onClose]
  )

  const filtered = useMemo(() => {
    if (!search) return actions
    const q = search.toLowerCase()
    return actions.filter((a) =>
      a.label.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
    )
  }, [actions, search])

  // Group by category for display
  const grouped = useMemo(() => {
    const groups: Record<string, QuickAction[]> = {}
    for (const action of filtered) {
      if (!groups[action.category]) groups[action.category] = []
      groups[action.category].push(action)
    }
    return groups
  }, [filtered])

  const flatFiltered = useMemo(() => filtered, [filtered])

  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
    setSearch('')
  }, [open])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, flatFiltered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && flatFiltered[selectedIndex]) {
        flatFiltered[selectedIndex].action()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [flatFiltered, selectedIndex, onClose]
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
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-[520px] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
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

            <div className="max-h-[400px] overflow-auto py-1">
              {search ? (
                // Flat list when searching
                flatFiltered.map((action, i) => (
                  <ActionItem key={action.id} action={action} selected={i === selectedIndex} onHover={() => setSelectedIndex(i)} />
                ))
              ) : (
                // Grouped by category
                Object.entries(grouped).map(([category, categoryActions]) => (
                  <div key={category}>
                    <div className="px-4 py-1.5 text-[10px] text-white/25 uppercase tracking-wider font-semibold">
                      {category}
                    </div>
                    {categoryActions.map((action) => {
                      const globalIndex = flatFiltered.indexOf(action)
                      return (
                        <ActionItem
                          key={action.id}
                          action={action}
                          selected={globalIndex === selectedIndex}
                          onHover={() => setSelectedIndex(globalIndex)}
                        />
                      )
                    })}
                  </div>
                ))
              )}
              {flatFiltered.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-white/30">No matching actions</div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function ActionItem({ action, selected, onHover }: { action: QuickAction; selected: boolean; onHover: () => void }) {
  return (
    <button
      onClick={action.action}
      onMouseEnter={onHover}
      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
        selected ? 'bg-white/5' : ''
      }`}
    >
      <action.icon
        size={14}
        className={selected ? 'text-[var(--accent-cyan)]' : 'text-white/40'}
      />
      <span className="flex-1 text-sm text-white/80">{action.label}</span>
      {action.shortcut && (
        <span className="text-[10px] text-white/30 font-mono">{action.shortcut}</span>
      )}
    </button>
  )
}
