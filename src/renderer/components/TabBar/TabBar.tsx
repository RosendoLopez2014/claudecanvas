import { useTabsStore, TabState } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { GitBranch, X, Plus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useCallback } from 'react'

function Tab({ tab, isActive, onActivate, onClose }: {
  tab: TabState
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  const branchLabel = tab.worktreeBranch || 'main'

  return (
    <motion.button
      layout
      onClick={onActivate}
      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-white/5 transition-colors shrink-0 max-w-[200px] ${
        isActive
          ? 'bg-[var(--bg-primary)] text-white/90'
          : 'bg-[var(--bg-secondary)] text-white/40 hover:text-white/60 hover:bg-white/5'
      }`}
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: 'auto' }}
      exit={{ opacity: 0, width: 0 }}
      transition={{ duration: 0.15 }}
    >
      {isActive && (
        <motion.div
          layoutId="tab-indicator"
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-cyan)]"
        />
      )}

      <span className="truncate">{tab.project.name}</span>
      <span className="text-[10px] text-white/20 shrink-0">
        <GitBranch size={9} className="inline -mt-px" /> {branchLabel}
      </span>

      <span
        onClick={onClose}
        className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
      >
        <X size={10} />
      </span>
    </motion.button>
  )
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore()
  const [showNewTabMenu, setShowNewTabMenu] = useState(false)

  const handleClose = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }, [closeTab])

  const handleNewTab = useCallback(() => {
    useProjectStore.getState().setScreen('project-picker')
  }, [])

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center bg-[var(--bg-secondary)] border-b border-white/5 no-drag">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => setActiveTab(tab.id)}
            onClose={(e) => handleClose(e, tab.id)}
          />
        ))}
      </AnimatePresence>

      <button
        onClick={handleNewTab}
        className="p-1.5 mx-1 rounded hover:bg-white/10 text-white/25 hover:text-white/50 transition-colors shrink-0"
        title="New tab"
      >
        <Plus size={12} />
      </button>
    </div>
  )
}
