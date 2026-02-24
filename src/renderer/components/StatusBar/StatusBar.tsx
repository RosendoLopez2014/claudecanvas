import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToastStore } from '@/stores/toast'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'
import {
  GitBranch, Play, Square, PanelRight, Eye, Loader2, FolderOpen,
  ArrowDown, ArrowUp, Check, Rocket, Settings, AlertTriangle
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { PushPopover } from './PushPopover'
import { TokenGauge } from './TokenGauge'
import { CommandPicker } from '../CommandPicker/CommandPicker'

export function StatusBar() {
  const { currentProject } = useProjectStore()
  const { inspectorActive, setInspectorActive } = useCanvasStore()
  const { mode, openCanvas, closeCanvas } = useWorkspaceStore()
  const showCanvas = mode === 'terminal-canvas'
  const [startingStatus, setStartingStatus] = useState<string | null>(null)
  const activeTab = useTabsStore(selectActiveTab)

  // Dev server state — derived from the active tab (NOT deprecated globals)
  const devStatus = activeTab?.dev.status ?? 'stopped'
  const isDevServerRunning = devStatus === 'running'

  // Reconcile dev server state from main process on tab switch.
  // Handles the case where a server started/stopped while viewing a different tab.
  const activeTabId = activeTab?.id ?? null
  useEffect(() => {
    const cwd = activeTab?.project.path
    if (!cwd || !activeTabId) return
    window.api.dev.status(cwd).then(({ running, url }) => {
      const current = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
      if (!current) return
      const isRunning = current.dev.status === 'running'
      // Only reconcile if main process disagrees with tab state
      if (running && !isRunning) {
        useTabsStore.getState().updateDevForProject(cwd, { status: 'running', url })
        if (url) useTabsStore.getState().updateTabsByProject(cwd, { previewUrl: url })
      } else if (!running && isRunning) {
        useTabsStore.getState().updateDevForProject(cwd, { status: 'stopped', url: null, pid: null })
        useTabsStore.getState().updateTabsByProject(cwd, { previewUrl: null })
      }
    })
  }, [activeTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  const gitAhead = activeTab?.gitAhead ?? 0
  const gitBehind = activeTab?.gitBehind ?? 0
  const gitRemoteConfigured = activeTab?.gitRemoteConfigured ?? false
  const gitFetchError = activeTab?.gitFetchError ?? null
  const [showPushPopover, setShowPushPopover] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [vercelConnected, setVercelConnected] = useState(false)
  // Command picker state
  const [showCommandPicker, setShowCommandPicker] = useState(false)
  const [commandPickerSuggestions, setCommandPickerSuggestions] = useState<string[]>([])
  const [commandPickerFramework, setCommandPickerFramework] = useState<string | null>(null)

  // Auto-updater state
  const [updateReady, setUpdateReady] = useState<string | null>(null)

  useEffect(() => {
    const unsub = window.api.updater.onStatus((data) => {
      if (data.status === 'ready' && data.version) {
        setUpdateReady(data.version)
      }
    })
    return unsub
  }, [])

  // Check Vercel connection status once on mount (not on every project change)
  useEffect(() => {
    window.api.oauth.vercel.status().then((s) => {
      setVercelConnected(s.connected)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeploy = useCallback(async () => {
    const path = activeTab?.project.path
    if (!path || deploying) return
    setDeploying(true)
    const { addToast } = useToastStore.getState()

    try {
      // First push current branch
      const pushResult = await window.api.git.squashAndPush(path, `Deploy from Claude Canvas`)
      if (!pushResult.success) {
        addToast(`Push failed: ${(pushResult as { error: string }).error}`, 'error')
        return
      }

      // Check for linked Vercel project
      const gitInfo = await window.api.git.getProjectInfo(path)
      const repoName = gitInfo.remoteUrl?.replace(/.*github\.com[:/]/, '').replace(/\.git$/, '') || null
      const linked = await window.api.oauth.vercel.linkedProject({
        projectPath: path,
        gitRepo: repoName || undefined,
      })

      if ('error' in linked) {
        addToast(`Deploy failed: ${linked.error}`, 'error')
        return
      }

      if (linked.linked && linked.latestDeployment) {
        // Trigger redeploy
        const redeploy = await window.api.oauth.vercel.redeploy(linked.latestDeployment.id)
        if ('error' in redeploy) {
          addToast(`Deploy failed: ${redeploy.error}`, 'error')
        } else {
          addToast(`Deploying... Preview: https://${redeploy.url}`, 'success')
          // Open deploy tab in canvas
          openCanvas()
          if (activeTab) useTabsStore.getState().updateTab(activeTab.id, { activeCanvasTab: 'deploy' })
        }
      } else {
        addToast('No linked Vercel project found. Link via Settings first.', 'info')
      }
    } catch (err) {
      addToast(`Deploy failed: ${err instanceof Error ? err.message : err}`, 'error')
    } finally {
      setDeploying(false)
    }
  }, [activeTab, deploying])

  const handlePull = useCallback(async () => {
    const path = activeTab?.project.path
    if (!path || pulling) return
    setPulling(true)
    const { addToast } = useToastStore.getState()
    try {
      const result = await window.api.git.pull(path)
      if (result.success) {
        if (result.conflicts) {
          addToast('Pulled with conflicts — resolve in terminal', 'error')
        } else {
          addToast('Pulled latest changes', 'success')
        }
        // Refresh counts
        const counts = await window.api.git.fetch(path)
        if (activeTab) {
          useTabsStore.getState().updateTab(activeTab.id, {
            gitAhead: counts.ahead || 0,
            gitBehind: counts.behind || 0,
            lastFetchTime: Date.now(),
          })
        }
      } else {
        addToast(`Pull failed: ${result.error}`, 'error')
      }
    } catch (err) {
      addToast(`Pull failed: ${err instanceof Error ? err.message : err}`, 'error')
    } finally {
      setPulling(false)
    }
  }, [activeTab, pulling])

  // Listen for dev server exit (crash, manual kill, etc.)
  // Filtered by cwd — only updates tabs that match the exited project.
  useEffect(() => {
    const removeExit = window.api.dev.onExit(({ cwd, code }) => {
      useTabsStore.getState().updateDevForProject(cwd, {
        status: 'stopped',
        url: null,
        pid: null,
        lastExitCode: code ?? null,
      })
      // Clear preview URL for all tabs of this project
      useTabsStore.getState().updateTabsByProject(cwd, { previewUrl: null })
      // Only clear local starting status if this is the active tab's project
      const active = useTabsStore.getState().getActiveTab()
      if (active?.project.path === cwd) {
        setStartingStatus(null)
      }
    })
    return removeExit
  }, [])

  // Listen for dev server status updates (self-healing feedback)
  // Filtered by cwd — only shows toasts/status for the active tab's project.
  useEffect(() => {
    const removeStatus = window.api.dev.onStatus((status) => {
      // Only update local UI status if this event matches the active tab
      const active = useTabsStore.getState().getActiveTab()
      if (status.cwd && active?.project.path !== status.cwd) return

      const { addToast } = useToastStore.getState()

      switch (status.stage) {
        case 'starting':
          setStartingStatus('Starting...')
          break
        case 'installing':
          setStartingStatus('Installing deps...')
          addToast(status.message, 'info')
          break
        case 'killing-port':
          setStartingStatus('Freeing port...')
          addToast(status.message, 'info')
          break
        case 'retrying':
          setStartingStatus('Retrying...')
          addToast(status.message, 'info')
          break
        case 'ready':
          setStartingStatus(null)
          break
        case 'error':
          setStartingStatus(null)
          addToast(status.message, 'error')
          break
      }
    })
    return removeStatus
  }, [])

  /** Check if the dev command can be auto-resolved for the current project.
   *  Returns true if auto-start is OK (main process will resolve the command).
   *  Returns false if the picker should be shown instead. */
  const canAutoStart = useCallback(async (): Promise<boolean> => {
    const cwd = currentProject?.path
    if (!cwd) return false

    // Always resolve fresh — the cached devCommand might be stale from a previous session
    try {
      const result = await window.api.dev.resolve(cwd)
      if (result?.error) {
        setCommandPickerSuggestions([])
        setCommandPickerFramework(null)
        setShowCommandPicker(true)
        return false
      }

      const plan = result.plan
      if (plan && plan.confidence !== 'low') {
        // High/medium confidence — cache for display, main process will resolve again on start
        const cmdStr = [plan.command.bin, ...plan.command.args].join(' ')
        useProjectStore.getState().setCurrentProject({
          ...currentProject,
          devCommand: cmdStr,
          devPort: plan.port,
          framework: plan.detection?.framework,
        })
        if (activeTab) {
          useTabsStore.getState().updateProjectInfo(activeTab.id, {
            devCommand: cmdStr,
            devPort: plan.port,
            framework: plan.detection?.framework,
          })
        }
        return true
      }

      // Low confidence — clear any stale cached command, then show picker
      if (currentProject.devCommand) {
        useProjectStore.getState().setCurrentProject({
          ...currentProject,
          devCommand: undefined,
          devPort: undefined,
        })
        if (activeTab) {
          useTabsStore.getState().updateProjectInfo(activeTab.id, {
            devCommand: undefined,
            devPort: undefined,
          })
        }
      }
      setCommandPickerSuggestions(
        plan ? [[plan.command.bin, ...plan.command.args].join(' ')] : []
      )
      setCommandPickerFramework(plan?.detection?.framework ?? null)
    } catch {
      setCommandPickerSuggestions([])
      setCommandPickerFramework(null)
    }

    // No confident command — show picker
    setShowCommandPicker(true)
    return false
  }, [currentProject, activeTab])

  /** Actually start the dev server. When command is omitted, the main
   *  process auto-resolves (handles subdirectory projects correctly). */
  const doStart = useCallback(async (command?: string) => {
    const cwd = currentProject?.path
    if (!cwd) return

    setStartingStatus('Starting...')
    useTabsStore.getState().updateDevForProject(cwd, { status: 'starting', lastError: null })

    try {
      const result = await window.api.dev.start(cwd, command)
      if (result?.error) {
        setStartingStatus(null)
        // If the server needs manual configuration, reset to stopped and show picker
        if (result.errorCode === 'DEV_COMMAND_UNRESOLVED' || result.needsConfiguration) {
          useTabsStore.getState().updateDevForProject(cwd, { status: 'stopped', lastError: null })
          setShowCommandPicker(true)
          return
        }
        useTabsStore.getState().updateDevForProject(cwd, {
          status: 'error',
          lastError: result.error,
        })
        // If crash loop, offer a way to clear and retry
        if (result.error.includes('crashed') && result.error.includes('times')) {
          useToastStore.getState().addToast(result.error, 'error', {
            duration: 10000,
            action: {
              label: 'Clear & Retry',
              onClick: async () => {
                await window.api.dev.clearCrashHistory(cwd)
                useTabsStore.getState().updateDevForProject(cwd, { status: 'stopped', lastError: null })
              },
            },
          })
        } else {
          useToastStore.getState().addToast(result.error, 'error')
        }
      } else if (result?.url) {
        setStartingStatus(null)
        useTabsStore.getState().updateDevForProject(cwd, {
          status: 'running',
          url: result.url,
          pid: result.pid ?? null,
        })
        useTabsStore.getState().updateTabsByProject(cwd, { previewUrl: result.url })
        openCanvas()
        useToastStore.getState().addToast(`Dev server on ${result.url}`, 'success')
      } else {
        setStartingStatus(null)
        useTabsStore.getState().updateDevForProject(cwd, {
          status: 'running',
          pid: result?.pid ?? null,
        })
        // Server started but no URL — still mark as running, user can check terminal
        useToastStore.getState().addToast('Dev server started — check terminal for URL', 'info')
      }
    } catch (err) {
      setStartingStatus(null)
      useTabsStore.getState().updateDevForProject(cwd, {
        status: 'error',
        lastError: String(err),
      })
      useToastStore.getState().addToast(`Failed to start: ${err}`, 'error')
    }
  }, [currentProject?.path, openCanvas])

  const startApp = useCallback(async () => {
    const cwd = currentProject?.path
    if (!cwd || isDevServerRunning || startingStatus) return

    // Check if another tab already started a server for this project
    const alreadyRunning = useTabsStore.getState().tabs.some(
      (t) => t.project.path === cwd && t.dev.status === 'running'
    )
    if (alreadyRunning) {
      // Server already running — just open the preview
      openCanvas()
      return
    }

    const ok = await canAutoStart()
    if (!ok) return // picker will be shown — start deferred to onCommandSelect
    await doStart() // no command — let main process resolve (handles subdirectories)
  }, [currentProject, isDevServerRunning, startingStatus, openCanvas, canAutoStart, doStart])

  /** Called by CommandPicker when the user selects or types a command. */
  const handleCommandSelect = useCallback(async (command: string, remember: boolean) => {
    setShowCommandPicker(false)
    if (remember && currentProject) {
      // Persist to config store via IPC (sets user override in electron-store)
      window.api.dev.setOverride(currentProject.path, command)
      // Also update in-memory project info for immediate display
      const updated = { ...currentProject, devCommand: command }
      useProjectStore.getState().setCurrentProject(updated)
      if (activeTab) {
        useTabsStore.getState().updateProjectInfo(activeTab.id, { devCommand: command })
      }
    }
    await doStart(command)
  }, [currentProject, activeTab, doStart])

  // Listen for start requests from other components (e.g. QuickActions)
  useEffect(() => {
    const handler = () => startApp()
    window.addEventListener('dev:request-start', handler)
    return () => window.removeEventListener('dev:request-start', handler)
  }, [startApp])

  const stopApp = useCallback(async () => {
    const cwd = currentProject?.path
    if (!cwd) return
    await window.api.dev.stop(cwd)
    useTabsStore.getState().updateDevForProject(cwd, {
      status: 'stopped',
      url: null,
      pid: null,
    })
    useTabsStore.getState().updateTabsByProject(cwd, { previewUrl: null })
    setStartingStatus(null)
    useToastStore.getState().addToast('Dev server stopped', 'info')
  }, [currentProject?.path])

  return (
    <>
    <CommandPicker
      open={showCommandPicker}
      onClose={() => setShowCommandPicker(false)}
      onSelect={handleCommandSelect}
      suggestions={commandPickerSuggestions}
      framework={commandPickerFramework}
      projectName={currentProject?.name ?? 'project'}
    />
    <div className="h-6 flex items-center justify-between px-3 bg-[var(--bg-secondary)] border-t border-white/10 text-[11px] text-white/50">
      <div className="flex items-center gap-3">
        {(activeTab || currentProject) && (
          <>
            <button
              onClick={() => useProjectStore.getState().setScreen('project-picker')}
              className="flex items-center gap-1 text-white/70 hover:text-white transition-colors"
              title="Open project picker"
            >
              <FolderOpen size={11} />
              <span>{activeTab?.project.name || currentProject?.name}</span>
            </button>
            <div className="flex items-center gap-1">
              <GitBranch size={11} />
              <span>{activeTab?.worktreeBranch || 'main'}</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Git sync indicators */}
        {gitRemoteConfigured && (
          <>
            {gitBehind > 0 && (
              <button
                data-pull-button
                onClick={handlePull}
                disabled={pulling}
                className="flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition-colors"
                title="Pull from remote"
              >
                {pulling ? <Loader2 size={10} className="animate-spin" /> : <ArrowDown size={10} />}
                <span>{gitBehind} Pull</span>
              </button>
            )}
            <div className="relative">
              {gitAhead > 0 ? (
                <button
                  data-push-button
                  onClick={() => setShowPushPopover((p) => !p)}
                  className="flex items-center gap-1 text-[var(--accent-cyan)] hover:text-white transition-colors"
                  title="Push to remote"
                >
                  <ArrowUp size={10} />
                  <span>{gitAhead} Push</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse" />
                </button>
              ) : gitFetchError ? (
                <span className="flex items-center gap-1 text-red-400/70" title={gitFetchError}>
                  <AlertTriangle size={10} />
                  <span>Sync error</span>
                </span>
              ) : gitBehind === 0 ? (
                <span className="flex items-center gap-1 text-white/20">
                  <Check size={10} />
                  <span>Synced</span>
                </span>
              ) : null}
              <AnimatePresence>
                {showPushPopover && <PushPopover onClose={() => setShowPushPopover(false)} />}
              </AnimatePresence>
            </div>
          </>
        )}

        {/* Deploy button (visible when Vercel connected) */}
        {vercelConnected && (
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className={`flex items-center gap-1 transition-colors ${
              deploying ? 'text-purple-400' : 'hover:text-purple-400'
            }`}
            title="Deploy to Vercel"
          >
            {deploying ? <Loader2 size={10} className="animate-spin" /> : <Rocket size={10} />}
            <span>{deploying ? 'Deploying...' : 'Deploy'}</span>
          </button>
        )}

        {/* Update available pill */}
        {updateReady && (
          <button
            onClick={() => window.api.updater.install()}
            className="flex items-center gap-1 text-[var(--accent-cyan)] hover:text-white transition-colors"
            title={`Update to v${updateReady} — click to restart`}
          >
            <ArrowDown size={10} />
            <span>v{updateReady} — Restart</span>
          </button>
        )}

        {/* Token usage gauge */}
        <TokenGauge />

        {/* Dev server start/stop + URL */}
        {isDevServerRunning ? (
          <>
            {/* Clickable URL when running */}
            {activeTab?.previewUrl && (
              <button
                onClick={() => {
                  openCanvas()
                  if (activeTab) useTabsStore.getState().updateTab(activeTab.id, { activeCanvasTab: 'preview' })
                }}
                className="flex items-center gap-1 text-emerald-400/70 hover:text-emerald-300 transition-colors font-mono"
                title={`Open preview: ${activeTab.previewUrl}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>{activeTab.previewUrl.replace('http://localhost:', ':')}</span>
              </button>
            )}
            <button
              onClick={stopApp}
              className="flex items-center gap-1 text-green-400 hover:text-red-400 transition-colors"
              title="Stop dev server"
            >
              <Square size={9} className="fill-current" />
              <span>Stop</span>
            </button>
          </>
        ) : devStatus === 'error' ? (
          <button
            onClick={startApp}
            className="flex items-center gap-1 text-red-400 hover:text-green-400 transition-colors"
            title={activeTab?.dev.lastError || 'Dev server error — click to retry'}
          >
            <AlertTriangle size={11} />
            <span>Retry</span>
          </button>
        ) : startingStatus ? (
          <span className="flex items-center gap-1 text-yellow-400">
            <Loader2 size={11} className="animate-spin" />
            <span>{startingStatus}</span>
          </span>
        ) : (
          <button
            onClick={startApp}
            className="flex items-center gap-1 hover:text-green-400 transition-colors"
            title={currentProject?.devCommand
              ? `Start: ${currentProject.devCommand}`
              : 'Start dev server'}
          >
            <Play size={11} className="fill-current" />
            <span>Start</span>
          </button>
        )}

        {/* Canvas toggle */}
        <button
          onClick={() => (showCanvas ? closeCanvas() : openCanvas())}
          className={`flex items-center gap-1 hover:text-white/80 transition-colors ${
            showCanvas ? 'text-[var(--accent-cyan)]' : ''
          }`}
          title="Toggle canvas (⌘\)"
        >
          <PanelRight size={11} />
          <span>Canvas</span>
        </button>

        {/* Inspector toggle */}
        <button
          onClick={() => setInspectorActive(!inspectorActive)}
          className={`flex items-center gap-1 hover:text-white/80 transition-colors ${
            inspectorActive ? 'text-[var(--accent-cyan)]' : ''
          }`}
          title="Toggle inspector (⌘I)"
        >
          <Eye size={11} />
          <span>Inspector</span>
        </button>

        {/* Settings */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-settings'))}
          className="flex items-center gap-1 hover:text-white/80 transition-colors"
          title="Settings (⌘,)"
        >
          <Settings size={11} />
        </button>

        {/* App version */}
        <span className="text-white/20">v{window.api.appVersion}</span>
      </div>
    </div>
    </>
  )
}
