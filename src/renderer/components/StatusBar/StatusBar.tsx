import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToastStore } from '@/stores/toast'
import { useTabsStore } from '@/stores/tabs'
import { GitBranch, Play, Square, PanelRight, Eye, Loader2, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export function StatusBar() {
  const { currentProject, isDevServerRunning, setDevServerRunning } = useProjectStore()
  const { inspectorActive, setInspectorActive, setPreviewUrl } = useCanvasStore()
  const { mode, openCanvas, closeCanvas } = useWorkspaceStore()
  const showCanvas = mode === 'terminal-canvas'
  const [startingStatus, setStartingStatus] = useState<string | null>(null)
  const activeTab = useTabsStore((s) => s.getActiveTab())

  // Listen for dev server exit (crash, manual kill, etc.)
  useEffect(() => {
    const removeExit = window.api.dev.onExit(() => {
      setDevServerRunning(false)
      setPreviewUrl(null)
      setStartingStatus(null)
    })
    return removeExit
  }, [setDevServerRunning, setPreviewUrl])

  // Listen for dev server status updates (self-healing feedback)
  useEffect(() => {
    const removeStatus = window.api.dev.onStatus((status) => {
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

  const startApp = useCallback(async () => {
    if (!currentProject?.path || isDevServerRunning || startingStatus) return
    setStartingStatus('Starting...')
    try {
      const result = await window.api.dev.start(currentProject.path, currentProject.devCommand)
      if (result?.error) {
        setStartingStatus(null)
        useToastStore.getState().addToast(result.error, 'error')
      } else if (result?.url) {
        setStartingStatus(null)
        setDevServerRunning(true)
        setPreviewUrl(result.url)
        openCanvas()
        useToastStore.getState().addToast(`Dev server on ${result.url}`, 'success')
      } else {
        setStartingStatus(null)
        setDevServerRunning(true)
        useToastStore.getState().addToast('Dev server started (URL not detected)', 'info')
      }
    } catch (err) {
      setStartingStatus(null)
      useToastStore.getState().addToast(`Failed to start: ${err}`, 'error')
    }
  }, [currentProject, isDevServerRunning, startingStatus, setDevServerRunning, setPreviewUrl, openCanvas])

  const stopApp = useCallback(async () => {
    await window.api.dev.stop()
    setDevServerRunning(false)
    setPreviewUrl(null)
    setStartingStatus(null)
    useToastStore.getState().addToast('Dev server stopped', 'info')
  }, [setDevServerRunning, setPreviewUrl])

  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[var(--bg-secondary)] border-t border-white/10 text-[11px] text-white/50">
      <div className="flex items-center gap-3">
        {(activeTab || currentProject) && (
          <>
            <span className="flex items-center gap-1 text-white/70">
              <FolderOpen size={11} />
              <span>{activeTab?.project.name || currentProject?.name}</span>
            </span>
            <div className="flex items-center gap-1">
              <GitBranch size={11} />
              <span>{activeTab?.worktreeBranch || 'main'}</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Dev server start/stop */}
        {isDevServerRunning ? (
          <button
            onClick={stopApp}
            className="flex items-center gap-1 text-green-400 hover:text-red-400 transition-colors"
            title="Stop dev server"
          >
            <Square size={9} className="fill-current" />
            <span>Stop</span>
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
            title="Start dev server"
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
      </div>
    </div>
  )
}
