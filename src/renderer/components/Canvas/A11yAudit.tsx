import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'

interface A11yIssue {
  id: string
  impact: 'critical' | 'serious' | 'moderate' | 'minor'
  description: string
  help: string
  helpUrl: string
  nodes: Array<{
    html: string
    target: string[]
    failureSummary: string
  }>
}

type AuditState = 'idle' | 'running' | 'done' | 'error'

const IMPACT_CONFIG = {
  critical: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  serious: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  moderate: { icon: Info, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  minor: { icon: Info, color: 'text-white/40', bg: 'bg-white/5' },
}

// axe-core CDN script injection
const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js'

export function A11yAudit() {
  const [issues, setIssues] = useState<A11yIssue[]>([])
  const [state, setState] = useState<AuditState>('idle')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const currentTab = useTabsStore(selectActiveTab)
  const previewUrl = currentTab?.previewUrl ?? null

  const runAudit = useCallback(async () => {
    setState('running')
    setIssues([])

    try {
      // Find the preview iframe
      const iframe = document.querySelector('iframe[name="claude-canvas-preview"]') as HTMLIFrameElement
      if (!iframe?.contentWindow) {
        setState('error')
        return
      }

      const win = iframe.contentWindow as any

      // Inject axe-core if not already present
      if (!win.axe) {
        await new Promise<void>((resolve, reject) => {
          const script = iframe.contentDocument?.createElement('script')
          if (!script) { reject(new Error('Cannot create script')); return }
          script.src = AXE_CDN
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load axe-core'))
          iframe.contentDocument?.head.appendChild(script)
        })
      }

      // Run audit
      const results = await win.axe.run(iframe.contentDocument, {
        runOnly: ['wcag2a', 'wcag2aa', 'best-practice']
      })

      const violations: A11yIssue[] = results.violations.map((v: any) => ({
        id: v.id,
        impact: v.impact || 'minor',
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n: any) => ({
          html: n.html?.slice(0, 200) || '',
          target: n.target || [],
          failureSummary: n.failureSummary || ''
        }))
      }))

      // Sort by severity
      const order = { critical: 0, serious: 1, moderate: 2, minor: 3 }
      violations.sort((a, b) => order[a.impact] - order[b.impact])

      setIssues(violations)
      setState('done')
    } catch (err) {
      console.error('A11y audit failed:', err)
      setState('error')
    }
  }, [])

  // Auto-run on preview URL change
  useEffect(() => {
    if (previewUrl) {
      const timer = setTimeout(runAudit, 2000) // Wait for page to load
      return () => clearTimeout(timer)
    }
  }, [previewUrl, runAudit])

  const counts = {
    critical: issues.filter((i) => i.impact === 'critical').length,
    serious: issues.filter((i) => i.impact === 'serious').length,
    moderate: issues.filter((i) => i.impact === 'moderate').length,
    minor: issues.filter((i) => i.impact === 'minor').length,
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60">
            {state === 'idle' && 'Run an accessibility audit'}
            {state === 'running' && 'Scanning...'}
            {state === 'done' && `${issues.length} issue${issues.length !== 1 ? 's' : ''} found`}
            {state === 'error' && 'Audit failed — is the preview loaded?'}
          </span>
          {state === 'done' && issues.length > 0 && (
            <div className="flex items-center gap-2 text-[10px]">
              {counts.critical > 0 && <span className="text-red-400">{counts.critical} critical</span>}
              {counts.serious > 0 && <span className="text-orange-400">{counts.serious} serious</span>}
              {counts.moderate > 0 && <span className="text-yellow-400">{counts.moderate} moderate</span>}
              {counts.minor > 0 && <span className="text-white/30">{counts.minor} minor</span>}
            </div>
          )}
        </div>
        <button
          onClick={runAudit}
          disabled={state === 'running'}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-white/40 hover:text-white/60 hover:bg-white/5 rounded transition"
        >
          <RefreshCw size={10} className={state === 'running' ? 'animate-spin' : ''} />
          {state === 'running' ? 'Scanning...' : 'Run Audit'}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {state === 'done' && issues.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <CheckCircle size={24} className="text-green-400" />
            <span className="text-xs text-green-400">No accessibility issues found!</span>
          </div>
        )}
        {issues.map((issue) => {
          const config = IMPACT_CONFIG[issue.impact]
          const expanded = expandedId === issue.id
          return (
            <button
              key={issue.id}
              onClick={() => setExpandedId(expanded ? null : issue.id)}
              className={`w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/[0.02] transition ${expanded ? 'bg-white/[0.02]' : ''}`}
            >
              <div className="flex items-start gap-2">
                <config.icon size={12} className={`${config.color} mt-0.5 flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                      {issue.impact}
                    </span>
                    <span className="text-xs text-white/70 truncate">{issue.help}</span>
                  </div>
                  {expanded && (
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] text-white/40">{issue.description}</p>
                      {issue.nodes.map((node, i) => (
                        <div key={i} className="bg-white/[0.03] rounded p-2 text-[10px]">
                          <code className="text-white/30 font-mono block truncate">{node.html}</code>
                          {node.failureSummary && (
                            <p className="text-white/40 mt-1">{node.failureSummary}</p>
                          )}
                        </div>
                      ))}
                      <a
                        href={issue.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[var(--accent-cyan)] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Learn more
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
