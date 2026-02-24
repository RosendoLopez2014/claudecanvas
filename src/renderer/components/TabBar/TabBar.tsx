import { useTabsStore, TabState } from '@/stores/tabs'
import { GitBranch, X, Plus, Check, Loader2, FolderOpen } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { destroyTerminalsForTab } from '@/services/terminalPool'
import { NewTabMenu } from './NewTabMenu'
import { useProjectStore } from '@/stores/project'

/** Group tabs by project name → returns Map<projectName, TabState[]> */
function useGroupedTabs() {
  const tabs = useTabsStore((s) => s.tabs)
  return useMemo(() => {
    const map = new Map<string, TabState[]>()
    for (const tab of tabs) {
      const key = tab.project.name
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tab)
    }
    return map
  }, [tabs])
}

/** Derive the active project name from the active tab */
function useActiveProjectName(): string | null {
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const tabs = useTabsStore((s) => s.tabs)
  const active = tabs.find((t) => t.id === activeTabId)
  return active?.project.name || null
}

/** Get notification info for a project group */
function getProjectNotification(projectTabs: TabState[]): { color: string; label: string } | null {
  const totalAhead = projectTabs.reduce((sum, t) => sum + t.gitAhead, 0)
  const hasDevServer = projectTabs.some((t) => t.dev.status === 'running')

  if (totalAhead > 0) return { color: 'bg-amber-400', label: `${totalAhead} unpushed` }
  if (hasDevServer) return { color: 'bg-emerald-400', label: 'dev running' }
  return null
}

/** Get branch badge text for a tab */
function getBranchBadge(tab: TabState): { text: string; color: string } | null {
  if (tab.gitAhead > 0) return { text: `↑${tab.gitAhead}`, color: 'bg-amber-500/20 text-amber-400' }
  if (tab.gitRemoteConfigured && tab.gitAhead === 0 && tab.gitBehind === 0) {
    return { text: '✓', color: 'bg-emerald-500/20 text-emerald-400' }
  }
  return null
}

// ── Row 1: Project Selector ─────────────────────────────────────────────

function ProjectChip({ name, isActive, notification, onClick, onClose }: {
  name: string
  isActive: boolean
  notification: { color: string; label: string } | null
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-1.5 px-3 py-1 text-[11px] rounded-md transition-all shrink-0 ${
        isActive
          ? 'bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/20'
          : 'text-white/40 hover:text-white/60 hover:bg-white/5 border border-transparent'
      }`}
    >
      <FolderOpen size={11} className={isActive ? 'text-[var(--accent-cyan)]' : 'text-white/20'} />
      <span className="truncate max-w-[120px]">{name}</span>
      {/* Notification dot for non-active projects */}
      {!isActive && notification && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${notification.color} shrink-0`}
          title={notification.label}
        />
      )}
      {/* Close project button */}
      <span
        onClick={onClose}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
        title="Close project"
      >
        <X size={9} />
      </span>
    </button>
  )
}

function ProjectSelector({ grouped, activeProject, onSelectProject, onCloseProject }: {
  grouped: Map<string, TabState[]>
  activeProject: string | null
  onSelectProject: (name: string) => void
  onCloseProject: (name: string) => void
}) {
  // Only show project row if there's more than 1 project
  if (grouped.size <= 1) return null

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-secondary)] border-b border-white/5 no-drag">
      {Array.from(grouped.entries()).map(([name, projectTabs]) => (
        <ProjectChip
          key={name}
          name={name}
          isActive={name === activeProject}
          notification={name !== activeProject ? getProjectNotification(projectTabs) : null}
          onClick={() => onSelectProject(name)}
          onClose={(e) => {
            e.stopPropagation()
            onCloseProject(name)
          }}
        />
      ))}
      <button
        onClick={() => useProjectStore.getState().setScreen('project-picker')}
        className="p-1 ml-0.5 rounded hover:bg-white/10 text-white/20 hover:text-white/40 transition-colors shrink-0"
        title="Add project"
      >
        <Plus size={11} />
      </button>
    </div>
  )
}

// ── Row 2: Branch Tabs ──────────────────────────────────────────────────

/** Dev server status dot colors */
const DEV_STATUS_COLORS: Record<string, string> = {
  running: 'bg-emerald-400',
  starting: 'bg-amber-400 animate-pulse',
  error: 'bg-red-400',
}

function BranchTab({ tab, isActive, onActivate, onClose }: {
  tab: TabState
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  const branchLabel = tab.worktreeBranch || 'main'
  const badge = getBranchBadge(tab)
  const devColor = DEV_STATUS_COLORS[tab.dev.status]

  return (
    <button
      onClick={onActivate}
      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors shrink-0 max-w-[200px] ${
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

      <GitBranch size={10} className={isActive ? 'text-[var(--accent-cyan)] shrink-0' : 'text-white/20 shrink-0'} />
      <span className="truncate">{branchLabel}</span>

      {/* Dev server status dot */}
      {devColor && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${devColor} shrink-0`}
          title={`Dev server: ${tab.dev.status}`}
        />
      )}

      {/* Branch status badge */}
      {badge && (
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium shrink-0 ${badge.color}`}>
          {badge.text}
        </span>
      )}

      <span
        onClick={onClose}
        className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
      >
        <X size={10} />
      </span>
    </button>
  )
}

// ── Main TabBar Component ───────────────────────────────────────────────

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore()
  const [showNewTabMenu, setShowNewTabMenu] = useState(false)
  const [exitSteps, setExitSteps] = useState<Array<{ label: string; done: boolean }> | null>(null)

  const grouped = useGroupedTabs()
  const activeProject = useActiveProjectName()

  // Tabs visible in row 2 — only the active project's tabs
  const visibleTabs = useMemo(() => {
    if (!activeProject) return tabs
    return grouped.get(activeProject) || []
  }, [grouped, activeProject, tabs])

  const handleSelectProject = useCallback((projectName: string) => {
    // Find the most recently active tab for this project
    // (use the first tab as fallback)
    const projectTabs = grouped.get(projectName)
    if (!projectTabs?.length) return
    // If the active tab is already in this project, do nothing
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab?.project.name === projectName) return
    // Activate the first tab of this project
    setActiveTab(projectTabs[0].id)
  }, [grouped, tabs, activeTabId, setActiveTab])

  const handleCloseTab = useCallback(async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (!tab) return

    const steps: Array<{ label: string; done: boolean }> = []
    if (tab.dev.status !== 'stopped') steps.push({ label: 'Stopping dev server', done: false })
    if (tab.ptyId) steps.push({ label: 'Detaching PTY session', done: false })
    steps.push({ label: 'Cleaning up resources', done: false })

    setExitSteps([...steps])

    try {
      await new Promise((r) => setTimeout(r, 200))

      let stepIdx = 0
      const tick = async (delay = 350) => {
        if (stepIdx < steps.length) {
          steps[stepIdx].done = true
          setExitSteps([...steps])
          stepIdx++
        }
        await new Promise((r) => setTimeout(r, delay))
      }

      if (tab.dev.status !== 'stopped') {
        try { await window.api.dev.stop(tab.project.path) } catch { /* ignore */ }
        await tick(400)
      }
      if (tab.ptyId) {
        try { window.api.pty.kill(tab.ptyId) } catch { /* ignore */ }
        await tick(300)
      }
      // Cleanup file watcher, git instance, + terminal pool
      try { window.api.fs.unwatch(tab.project.path) } catch { /* ignore */ }
      try { window.api.git.cleanup(tab.project.path) } catch { /* ignore */ }
      destroyTerminalsForTab(tabId)
      await tick(300)

      await new Promise((r) => setTimeout(r, 300))
    } finally {
      setExitSteps(null)
      closeTab(tabId)
    }
  }, [closeTab])

  const handleCloseProject = useCallback(async (projectName: string) => {
    const projectTabs = grouped.get(projectName)
    if (!projectTabs?.length) return

    // Close all tabs for this project sequentially
    for (const tab of projectTabs) {
      if (tab.dev.status !== 'stopped') {
        try { await window.api.dev.stop(tab.project.path) } catch { /* ignore */ }
      }
      if (tab.ptyId) {
        try { window.api.pty.kill(tab.ptyId) } catch { /* ignore */ }
      }
      try { window.api.fs.unwatch(tab.project.path) } catch { /* ignore */ }
      try { window.api.git.cleanup(tab.project.path) } catch { /* ignore */ }
      destroyTerminalsForTab(tab.id)
      closeTab(tab.id)
    }
  }, [grouped, closeTab])

  const handleNewTab = useCallback(() => {
    setShowNewTabMenu((prev) => !prev)
  }, [])

  if (tabs.length === 0) return null

  // Single-project mode: show project name + branch tabs in one row
  const singleProject = grouped.size === 1

  return (
    <>
      {/* Row 1: Project selector (only when multiple projects) */}
      <ProjectSelector
        grouped={grouped}
        activeProject={activeProject}
        onSelectProject={handleSelectProject}
        onCloseProject={handleCloseProject}
      />

      {/* Row 2: Branch tabs for the active project */}
      <div className="flex items-center bg-[var(--bg-secondary)] border-b border-white/5 no-drag">
        {/* Single-project label (when only 1 project, show its name as context) */}
        {singleProject && (
          <div className="group flex items-center gap-1.5 px-3 py-1.5 border-r border-white/5 shrink-0">
            <FolderOpen size={10} className="text-white/20" />
            <span className="text-[10px] text-white/25">{activeProject}</span>
            <span
              onClick={() => activeProject && handleCloseProject(activeProject)}
              className="p-0.5 rounded cursor-pointer opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
              title="Close project"
            >
              <X size={8} className="text-white/25" />
            </span>
          </div>
        )}

        {/* Branch tabs */}
        <div className="flex items-center overflow-x-auto">
          {visibleTabs.map((tab) => (
            <BranchTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onActivate={() => setActiveTab(tab.id)}
              onClose={(e) => handleCloseTab(e, tab.id)}
            />
          ))}
        </div>

        {/* New tab button */}
        <div className="relative">
          <button
            onClick={handleNewTab}
            className="p-1.5 mx-1 rounded hover:bg-white/10 text-white/25 hover:text-white/50 transition-colors shrink-0"
            title="New branch (⌘T)"
          >
            <Plus size={12} />
          </button>
          <AnimatePresence>
            {showNewTabMenu && <NewTabMenu onClose={() => setShowNewTabMenu(false)} />}
          </AnimatePresence>
        </div>
      </div>

      {/* Close tab overlay */}
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
