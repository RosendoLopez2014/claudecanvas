import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Settings, Key, Play, Square, Clock, CheckCircle, XCircle,
  AlertTriangle, ChevronDown, ChevronRight, Loader2, Eye, Trash2,
  Zap, Shield, Copy, ShieldOff, RotateCcw, X, FileText
} from 'lucide-react'
import { useActiveTab } from '@/stores/tabs'
import { useCriticStore, type CriticSession } from '@/stores/critic'
import { useProjectStore } from '@/stores/project'
import type { CriticFeedback, CriticConfig } from '../../../shared/critic/types'
import { DEFAULT_CRITIC_CONFIG } from '../../../shared/critic/types'
import { formatFeedbackForClaude } from '../../../shared/critic/format'

// ── Models ──────────────────────────────────────────────────
const OPENAI_MODELS = [
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.2-pro', label: 'GPT-5.2 Pro' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'o3', label: 'o3' },
  { value: 'o3-pro', label: 'o3 Pro' },
  { value: 'o4-mini', label: 'o4 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
]

const SEVERITY_COLORS = {
  critical: 'text-red-400',
  major: 'text-orange-400',
  minor: 'text-yellow-400',
  suggestion: 'text-blue-400',
}

const VERDICT_CONFIG = {
  approve: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Approved' },
  revise: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Revise' },
  reject: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Rejected' },
}

// ── Compact Verdict Badge ───────────────────────────────────
function VerdictBadge({ feedback, type }: { feedback: CriticFeedback; type: 'plan' | 'result' }) {
  const [expanded, setExpanded] = useState(false)
  const vc = VERDICT_CONFIG[feedback.verdict]
  const VIcon = vc.icon

  return (
    <div className="rounded-lg border border-white/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 w-full px-3 py-2 ${vc.bg} hover:brightness-110 transition`}
      >
        <VIcon className={`w-3.5 h-3.5 ${vc.color}`} />
        <span className={`text-xs font-medium ${vc.color}`}>{vc.label}</span>
        <span className="text-[10px] text-white/30 ml-auto">{type === 'plan' ? 'Plan' : 'Code'}</span>
        {feedback.issues.length > 0 && (
          <span className="text-[10px] text-white/30">{feedback.issues.length} issues</span>
        )}
        {expanded ? <ChevronDown className="w-3 h-3 text-white/20" /> : <ChevronRight className="w-3 h-3 text-white/20" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2">
          <p className="text-[11px] text-white/60 leading-relaxed">{feedback.summary}</p>
          {feedback.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px]">
              <span className={`${SEVERITY_COLORS[issue.severity]} font-mono text-[9px] uppercase mt-0.5`}>
                {issue.severity.slice(0, 4)}
              </span>
              <span className="text-white/50">{issue.description}</span>
            </div>
          ))}
          {feedback.strengths && feedback.strengths.length > 0 && (
            <div className="pt-1 border-t border-white/5">
              {feedback.strengths.map((s, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-green-400/50">
                  <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  {s}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(formatFeedbackForClaude(feedback, type))
            }}
            className="flex items-center gap-1 text-[10px] text-white/25 hover:text-white/50 transition-colors"
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        </div>
      )}
    </div>
  )
}

// ── Gate Status Bar ─────────────────────────────────────────
function GateBar({ status, reason, projectPath }: {
  status: string; reason: string; projectPath: string
}) {
  if (status === 'open') return null

  const isGated = status === 'gated'
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 ${isGated ? 'bg-red-500/5' : 'bg-yellow-500/5'}`}>
      {isGated ? (
        <Shield className="w-3 h-3 text-red-400 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0" />
      )}
      <span className={`text-[10px] truncate ${isGated ? 'text-red-400/70' : 'text-yellow-400/70'}`}>
        {reason}
      </span>
      {isGated && (
        <button
          onClick={async () => {
            await window.api.critic.overrideGate(projectPath, 'Manual override from panel')
          }}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-red-500/10 hover:bg-red-500/20
            rounded text-red-400/70 transition-colors flex-shrink-0 ml-auto"
        >
          <ShieldOff className="w-2.5 h-2.5" /> Override
        </button>
      )}
    </div>
  )
}

// ── Settings (inline, no accordion wrapper) ─────────────────
function InlineSettings({ projectPath, hasKey, onKeyDeleted, onKeySaved }: {
  projectPath: string; hasKey: boolean; onKeyDeleted: () => void; onKeySaved: () => void
}) {
  const [config, setConfig] = useState<CriticConfig>(DEFAULT_CRITIC_CONFIG)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.critic.getConfig(projectPath).then((c: any) => {
      if (c && !c.error) setConfig(c)
    })
  }, [projectPath])

  const updateConfig = useCallback(async (partial: Partial<CriticConfig>) => {
    const next = { ...config, ...partial }
    setConfig(next)
    await window.api.critic.setConfig(projectPath, next)
  }, [config, projectPath])

  const saveKey = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    await window.api.critic.setApiKey(apiKey.trim())
    setApiKey('')
    setSaving(false)
    onKeySaved()
  }

  return (
    <div className="space-y-2">
      {/* Enable toggle + model on same row */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-white/50">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
            className="rounded border-white/20 w-3 h-3"
          />
          Enabled
        </label>
        <select
          value={config.model}
          onChange={(e) => updateConfig({ model: e.target.value })}
          className="ml-auto px-1.5 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded
            text-white/50 focus:outline-none appearance-none cursor-pointer"
        >
          {OPENAI_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Gate mode + auto-review */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-white/50">
          <input
            type="checkbox"
            checked={config.autoReviewPlan}
            onChange={(e) => updateConfig({ autoReviewPlan: e.target.checked })}
            className="rounded border-white/20 w-3 h-3"
          />
          Auto-review
        </label>
        <select
          value={config.gateMode}
          onChange={(e) => updateConfig({ gateMode: e.target.value as 'recommended' | 'strict' })}
          className="ml-auto px-1.5 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded
            text-white/50 focus:outline-none appearance-none cursor-pointer"
        >
          <option value="recommended">Recommended</option>
          <option value="strict">Strict</option>
        </select>
      </div>

      {/* API key */}
      {!hasKey ? (
        <div className="flex gap-1.5">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            placeholder="sk-..."
            className="flex-1 px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded
              text-white/60 placeholder:text-white/15 focus:outline-none focus:border-[#4AEAFF]/50"
          />
          <button
            onClick={saveKey}
            disabled={saving || !apiKey.trim()}
            className="px-2 py-1 text-[10px] bg-white/10 hover:bg-white/15 rounded text-white/60
              disabled:opacity-30 transition-colors"
          >
            {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Save'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[10px]">
          <Key className="w-3 h-3 text-green-400/40" />
          <span className="text-green-400/40">Key configured</span>
          <button
            onClick={async () => { await window.api.critic.setApiKey(''); onKeyDeleted() }}
            className="ml-auto text-white/20 hover:text-red-400/50 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Context Card — shows what's being reviewed ──────────────
function ReviewContext({ session, projectPath }: {
  session: CriticSession | null; projectPath: string
}) {
  const projectName = useMemo(() => projectPath.split('/').pop() || projectPath, [projectPath])
  const isReviewing = session?.phase?.includes('reviewing')
  const phase = session?.phase?.replace(/_/g, ' ') ?? 'idle'

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02]">
      <FileText className="w-3 h-3 text-white/20 flex-shrink-0" />
      <span className="text-[10px] text-white/30 truncate font-mono">{projectName}</span>
      {isReviewing && <Loader2 className="w-3 h-3 animate-spin text-purple-400 ml-auto flex-shrink-0" />}
      {!isReviewing && session && (
        <span className="text-[10px] text-white/20 ml-auto">{phase}</span>
      )}
    </div>
  )
}

// ── Plan Preview (compact) ──────────────────────────────────
function PlanPreviewCompact({ tabId, projectPath }: { tabId: string; projectPath: string }) {
  const pending = useCriticStore((s) => s.pendingPlans[tabId])
  const dismissPlan = useCriticStore((s) => s.dismissPendingPlan)
  const [reviewing, setReviewing] = useState(false)

  if (!pending) return null

  const handleReview = async () => {
    setReviewing(true)
    dismissPlan(tabId)
    try {
      await window.api.critic.reviewPlan(tabId, projectPath, pending.planText, `Project: ${projectPath}`)
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="rounded-lg border border-purple-500/15 bg-purple-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Eye className="w-3 h-3 text-purple-400" />
        <span className="text-[10px] font-medium text-purple-300">Plan detected</span>
        <span className="text-[9px] text-purple-400/40 ml-auto tabular-nums">
          {Math.round(pending.confidence * 100)}%
        </span>
      </div>
      <pre className="px-3 py-1.5 text-[9px] text-white/30 max-h-20 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
        {pending.planText.slice(0, 400)}{pending.planText.length > 400 && '…'}
      </pre>
      <div className="flex gap-1.5 px-3 py-1.5 border-t border-purple-500/10">
        <button
          onClick={handleReview}
          disabled={reviewing}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-500/15 hover:bg-purple-500/25
            rounded text-purple-300 transition-colors disabled:opacity-40"
        >
          {reviewing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Play className="w-2.5 h-2.5" />}
          Review
        </button>
        <button
          onClick={() => dismissPlan(tabId)}
          className="px-2 py-0.5 text-[10px] text-white/30 hover:text-white/50 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// ── Main CriticPanel (sidebar) ──────────────────────────────
export function CriticPanel({ onClose }: { onClose?: () => void }) {
  const currentTab = useActiveTab()
  const tabId = currentTab?.id ?? null
  const { currentProject } = useProjectStore()
  const projectPath = currentProject?.path ?? null

  const session = useCriticStore((s) => tabId ? s.activeSessions[tabId] : undefined)
  const recentSessions = useCriticStore((s) => s.recentSessions)
  const latestSession = session ?? recentSessions.find((s) => s.tabId === tabId) ?? null
  const pendingPlan = useCriticStore((s) => tabId ? s.pendingPlans[tabId] : undefined)
  const gateState = useCriticStore((s) => projectPath ? s.gateStates[projectPath] : undefined)

  const [hasKey, setHasKey] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runningDiagnostics, setRunningDiagnostics] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  useEffect(() => {
    window.api.critic.hasApiKey().then(setHasKey)
  }, [])

  const handleRunReview = useCallback(async () => {
    if (!tabId || !projectPath) return
    setRunningDiagnostics(true)
    setReviewError(null)
    try {
      const [diagnostics, diff] = await Promise.all([
        window.api.critic.collectDiagnostics(projectPath),
        window.api.git.diff(projectPath).catch(() => ''),
      ])
      const diffStr = (diff as string).trim()
      if (!diffStr && !diagnostics?.tscOutput?.trim() && !diagnostics?.testOutput?.trim()) {
        setReviewError('No changes to review')
        return
      }
      const result = await window.api.critic.reviewResult(
        tabId, projectPath, diffStr, diagnostics, `Project: ${projectPath}`
      )
      if (result && typeof result === 'object' && 'error' in result) {
        setReviewError((result as { error: string }).error)
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunningDiagnostics(false)
    }
  }, [tabId, projectPath])

  if (!tabId || !projectPath) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
          <Zap className="w-3 h-3 text-purple-400" />
          <span className="text-[11px] font-medium text-white/70">Critic</span>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-white/20 hover:text-white/50 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center text-[10px] text-white/20 px-4 text-center">
          Open a project to use the critic
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0A0F1A]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <Zap className="w-3 h-3 text-purple-400" />
        <span className="text-[11px] font-medium text-white/70">Critic</span>
        {latestSession && latestSession.iteration > 0 && (
          <span className="text-[9px] text-white/25 tabular-nums">
            iter {latestSession.iteration}/{latestSession.maxIterations}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="text-white/20 hover:text-white/50 transition-colors p-0.5"
          >
            <Settings className="w-3 h-3" />
          </button>
          {onClose && (
            <button onClick={onClose} className="text-white/20 hover:text-white/50 transition-colors p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Gate status */}
      <GateBar
        status={gateState?.status ?? 'open'}
        reason={gateState?.reason ?? ''}
        projectPath={projectPath}
      />

      {/* Context — what project/file is being reviewed */}
      <ReviewContext session={latestSession} projectPath={projectPath} />

      {/* Settings (collapsible) */}
      {settingsOpen && (
        <div className="px-3 py-2 border-b border-white/5">
          <InlineSettings
            projectPath={projectPath}
            hasKey={hasKey}
            onKeyDeleted={() => setHasKey(false)}
            onKeySaved={() => setHasKey(true)}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {/* Pending plan */}
        <PlanPreviewCompact tabId={tabId} projectPath={projectPath} />

        {/* Plan feedback */}
        {latestSession?.planFeedback && (
          <VerdictBadge feedback={latestSession.planFeedback} type="plan" />
        )}

        {/* Result feedback */}
        {latestSession?.resultFeedback && (
          <VerdictBadge feedback={latestSession.resultFeedback} type="result" />
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={handleRunReview}
            disabled={runningDiagnostics || (session?.phase === 'critic_reviewing_result')}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-white/10 hover:bg-white/15
              rounded text-white/60 transition-colors disabled:opacity-30"
          >
            {runningDiagnostics ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Play className="w-2.5 h-2.5" />}
            Review Code
          </button>
          {session && (
            <button
              onClick={() => tabId && window.api.critic.abort(tabId)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-red-500/10 hover:bg-red-500/20
                rounded text-red-400/60 transition-colors"
            >
              <Square className="w-2.5 h-2.5" /> Stop
            </button>
          )}
        </div>

        {/* Errors */}
        {(reviewError || latestSession?.error) && (
          <div className="px-2 py-1.5 bg-red-500/5 border border-red-500/10 rounded text-[10px] text-red-400/60">
            {reviewError || latestSession?.error}
          </div>
        )}

        {/* Event log (compact) */}
        {latestSession && latestSession.events.length > 0 && (
          <div className="border-t border-white/5 pt-2">
            <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Events</div>
            <div className="max-h-24 overflow-y-auto space-y-0.5">
              {latestSession.events.slice(-8).map((evt, i) => (
                <div key={i} className="text-[9px] text-white/20 truncate">
                  <span className="text-white/10 tabular-nums mr-1">
                    {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {evt.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!latestSession && !pendingPlan && (
          <div className="flex flex-col items-center py-6 text-center">
            <Zap className="w-6 h-6 text-white/5 mb-2" />
            <p className="text-[10px] text-white/20 max-w-[200px]">
              Enable the critic to review plans and code via OpenAI.
            </p>
          </div>
        )}
      </div>

      {/* Footer — panic restore */}
      <div className="border-t border-white/5 px-3 py-1.5">
        <button
          onClick={async () => {
            await window.api.critic.restoreStaleBackups(projectPath)
            useCriticStore.getState().setGateState(projectPath, 'open', 'Manual restore')
          }}
          className="flex items-center gap-1 text-[9px] text-white/15 hover:text-white/40 transition-colors"
          title="Restore original tool permissions if stuck in gated state"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          Restore permissions
        </button>
      </div>
    </div>
  )
}
