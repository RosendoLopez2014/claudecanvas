import { useTabsStore, TabState } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { GitBranch, X, Plus, Check, Loader2 } from 'lucide-react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { destroyTerminal } from '@/services/terminalPool'

function Tab({ tab, isActive, onActivate, onClose }: {
  tab: TabState
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  const branchLabel = tab.worktreeBranch || 'main'

  return (
    <button
      onClick={onActivate}
      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-white/5 transition-colors shrink-0 max-w-[200px] ${
        isActive
          ? 'bg-[var(--bg-primary)] text-white/90'
          : 'bg-[var(--bg-secondary)] text-white/40 hover:text-white/60 hover:bg-white/5'
      }`}
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
    </button>
  )
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, reorderTabs } = useTabsStore()
  const [showNewTabMenu, setShowNewTabMenu] = useState(false)
  const [closingTabId, setClosingTabId] = useState<string | null>(null)
  const [exitSteps, setExitSteps] = useState<Array<{ label: string; done: boolean }> | null>(null)

  const handleCloseTab = useCallback(async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (!tab) return

    const steps: Array<{ label: string; done: boolean }> = []
    if (tab.isDevServerRunning) steps.push({ label: 'Stopping dev server', done: false })
    if (tab.ptyId) steps.push({ label: 'Detaching PTY session', done: false })
    steps.push({ label: 'Cleaning up resources', done: false })

    setClosingTabId(tabId)
    setExitSteps([...steps])
    await new Promise((r) => setTimeout(r, 200))

    let stepIdx = 0
    const tick = async (delay = 350) => {
      steps[stepIdx].done = true
      setExitSteps([...steps])
      stepIdx++
      await new Promise((r) => setTimeout(r, delay))
    }

    if (tab.isDevServerRunning) {
      await window.api.dev.stop(tab.project.path)
      await tick(400)
    }
    if (tab.ptyId) {
      window.api.pty.kill(tab.ptyId)
      await tick(300)
    }
    // Cleanup resources
    destroyTerminal(tabId)
    await tick(300)

    await new Promise((r) => setTimeout(r, 300))
    setClosingTabId(null)
    setExitSteps(null)
    closeTab(tabId)
  }, [closeTab])

  const handleNewTab = useCallback(() => {
    useProjectStore.getState().setScreen('project-picker')
  }, [])

  if (tabs.length === 0) return null

  return (
    <>
      <div className="flex items-center bg-[var(--bg-secondary)] border-b border-white/5 no-drag">
        <Reorder.Group
          axis="x"
          values={tabs}
          onReorder={reorderTabs}
          className="flex items-center"
          as="div"
        >
          {tabs.map((tab) => (
            <Reorder.Item
              key={tab.id}
              value={tab}
              as="div"
              className="shrink-0"
              whileDrag={{ scale: 1.02, opacity: 0.8 }}
            >
              <Tab
                tab={tab}
                isActive={tab.id === activeTabId}
                onActivate={() => setActiveTab(tab.id)}
                onClose={(e) => handleCloseTab(e, tab.id)}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>

        <button
          onClick={handleNewTab}
          className="p-1.5 mx-1 rounded hover:bg-white/10 text-white/25 hover:text-white/50 transition-colors shrink-0"
          title="New tab"
        >
          <Plus size={12} />
        </button>
      </div>

      {createPortal(
        <AnimatePresence>
          {exitSteps && (
            <motion.div
              className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--bg-primary)]/90 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 6 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.97, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="text-center"
              >
                <div className="text-sm text-white/50 mb-5">Closing tab...</div>
                <div className="flex flex-col gap-2.5 items-start">
                  {exitSteps.map((step, i) => (
                    <motion.div
                      key={step.label}
                      className="flex items-center gap-2.5"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.15 }}
                    >
                      {step.done ? (
                        <Check size={12} className="text-green-400 shrink-0" />
                      ) : (
                        <Loader2 size={12} className="text-[var(--accent-cyan)] animate-spin shrink-0" />
                      )}
                      <span className={`text-xs ${step.done ? 'text-white/40' : 'text-white/70'} transition-colors`}>
                        {step.label}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
