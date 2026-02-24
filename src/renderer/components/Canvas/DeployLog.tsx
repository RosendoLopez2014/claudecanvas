import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, CheckCircle2, XCircle, RotateCw } from 'lucide-react'
import { useProjectStore } from '@/stores/project'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'

interface LogEntry {
  text: string
  created: number
  type: string
}

type DeployState = 'idle' | 'loading' | 'streaming' | 'success' | 'error'

export function DeployLog() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [state, setState] = useState<DeployState>('idle')
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval>>()
  const projectPath = useProjectStore((s) => s.currentProject?.path)
  const activeTab = useTabsStore(selectActiveTab)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    if (!projectPath) return

    setState('loading')

    try {
      // Get linked project
      const gitInfo = await window.api.git.getProjectInfo(projectPath)
      const repoName = gitInfo.remoteUrl?.replace(/.*github\.com[:/]/, '').replace(/\.git$/, '') || null
      const linked = await window.api.oauth.vercel.linkedProject({
        projectPath,
        gitRepo: repoName || undefined,
      })

      if ('error' in linked || !linked.linked || !linked.latestDeployment) {
        setState('idle')
        return
      }

      const deployment = linked.latestDeployment
      setDeploymentUrl(`https://${deployment.url}`)

      // Fetch build logs
      const buildLogs = await window.api.oauth.vercel.buildLogs(deployment.id)
      if ('error' in buildLogs) {
        setState('error')
        return
      }

      setLogs(buildLogs as LogEntry[])
      setState(deployment.state === 'READY' ? 'success' : deployment.state === 'ERROR' ? 'error' : 'streaming')

      // If still building, poll every 3 seconds
      if (deployment.state !== 'READY' && deployment.state !== 'ERROR') {
        pollingRef.current = setInterval(async () => {
          const updated = await window.api.oauth.vercel.linkedProject({
            projectPath: projectPath!,
            gitRepo: repoName || undefined,
          })

          if ('error' in updated || !updated.linked || !updated.latestDeployment) return

          const newLogs = await window.api.oauth.vercel.buildLogs(updated.latestDeployment.id)
          if (!('error' in newLogs)) {
            setLogs(newLogs as LogEntry[])
            scrollToBottom()
          }

          if (updated.latestDeployment.state === 'READY' || updated.latestDeployment.state === 'ERROR') {
            setState(updated.latestDeployment.state === 'READY' ? 'success' : 'error')
            clearInterval(pollingRef.current)
          }
        }, 3000)
      }
    } catch {
      setState('error')
    }
  }, [projectPath, scrollToBottom])

  useEffect(() => {
    fetchLogs()
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [fetchLogs])

  useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

  const stateIcon = {
    idle: null,
    loading: <Loader2 size={12} className="animate-spin text-white/40" />,
    streaming: <Loader2 size={12} className="animate-spin text-yellow-400" />,
    success: <CheckCircle2 size={12} className="text-green-400" />,
    error: <XCircle size={12} className="text-red-400" />,
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          {stateIcon[state]}
          <span className="text-xs text-white/60">
            {state === 'idle' && 'No active deployment'}
            {state === 'loading' && 'Loading deployment logs...'}
            {state === 'streaming' && 'Building...'}
            {state === 'success' && 'Deployment successful'}
            {state === 'error' && 'Deployment failed'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {deploymentUrl && state === 'success' && (
            <a
              href={deploymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[var(--accent-cyan)] hover:underline"
            >
              Open preview
            </a>
          )}
          <button
            onClick={fetchLogs}
            className="p-1 hover:bg-white/10 rounded transition"
            title="Refresh logs"
          >
            <RotateCw size={11} className="text-white/30" />
          </button>
        </div>
      </div>

      {/* Log output */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px]">
        {logs.length === 0 && state === 'idle' ? (
          <div className="text-center text-white/20 py-8">
            Deploy your project to see build logs here.
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`py-0.5 ${
              log.type === 'stderr' ? 'text-red-400/70' : 'text-white/50'
            }`}>
              <span className="text-white/15 mr-2">
                {new Date(log.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
