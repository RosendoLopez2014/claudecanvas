import { useState, useCallback, useEffect } from 'react'
import {
  Settings, Key, Send, Play, Square, Clock, CheckCircle, XCircle,
  AlertTriangle, ChevronDown, ChevronRight, Loader2, Eye, Trash2,
  MessageSquare, Zap
} from 'lucide-react'
import { useActiveTab, useTabsStore } from '@/stores/tabs'
import { useCriticStore, type CriticSession } from '@/stores/critic'
import { useProjectStore } from '@/stores/project'
import type { CriticFeedback, CriticIssue, CriticConfig } from '../../../shared/critic/types'
import { DEFAULT_CRITIC_CONFIG } from '../../../shared/critic/types'
import { formatFeedbackForClaude } from '../../../shared/critic/format'

// ── Available models ─────────────────────────────────────────
const OPENAI_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'o1', label: 'o1' },
  { value: 'o1-mini', label: 'o1 Mini' },
  { value: 'o3-mini', label: 'o3 Mini' },
]

// ── Severity config ──────────────────────────────────────────
const SEVERITY_CONFIG = {
  critical: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Critical' },
  major: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Major' },
  minor: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Minor' },
  suggestion: { icon: MessageSquare, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Suggestion' },
}

const VERDICT_CONFIG = {
  approve: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Approved' },
  revise: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Revise' },
  reject: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Rejected' },
}

// ── Setup Prompt ─────────────────────────────────────────────
function CriticSetupPrompt({ hasKey, onKeySaved }: { hasKey: boolean; onKeySaved: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  if (hasKey) return null

  const saveKey = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    await window.api.critic.setApiKey(apiKey.trim())
    setApiKey('')
    setSaving(false)
    onKeySaved()
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Key className="w-10 h-10 text-white/20" />
      <h3 className="text-sm font-medium text-white/80">OpenAI API Key Required</h3>
      <p className="text-xs text-white/40 max-w-sm">
        The critic loop uses OpenAI to review plans and implementations.
        Your key is encrypted with your OS keychain.
      </p>
      <div className="flex gap-2 w-full max-w-sm">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          placeholder="sk-..."
          className="flex-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md
            text-white/80 placeholder:text-white/20 focus:outline-none focus:border-[#4AEAFF]/50"
        />
        <button
          onClick={saveKey}
          disabled={saving || !apiKey.trim()}
          className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 rounded-md text-white/80
            disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Settings Panel ───────────────────────────────────────────
function CriticSettings({ projectPath, hasKey, onKeyDeleted }: {
  projectPath: string
  hasKey: boolean
  onKeyDeleted: () => void
}) {
  const [config, setConfig] = useState<CriticConfig>(DEFAULT_CRITIC_CONFIG)
  const [expanded, setExpanded] = useState(false)

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

  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs text-white/60 hover:text-white/80 transition-colors"
      >
        <Settings className="w-3 h-3" />
        <span>Settings</span>
        {expanded ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Enable/Disable */}
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => updateConfig({ enabled: e.target.checked })}
              className="rounded border-white/20"
            />
            Enable critic loop
          </label>

          {/* Model dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 w-20">Model:</span>
            <select
              value={config.model}
              onChange={(e) => updateConfig({ model: e.target.value })}
              className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-white/70
                focus:outline-none focus:border-[#4AEAFF]/50 appearance-none cursor-pointer"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%23666\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              {OPENAI_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Max iterations */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 w-20">Max iters:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxIterations}
              onChange={(e) => updateConfig({ maxIterations: Math.max(1, parseInt(e.target.value) || 3) })}
              className="w-16 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-white/70
                focus:outline-none focus:border-[#4AEAFF]/50"
            />
          </div>

          {/* API Key status */}
          <div className="flex items-center gap-2 text-xs">
            <Key className="w-3 h-3 text-white/30" />
            <span className={hasKey ? 'text-green-400/60' : 'text-red-400/60'}>
              {hasKey ? 'API key configured' : 'No API key'}
            </span>
            {hasKey && (
              <button
                onClick={async () => {
                  await window.api.critic.setApiKey('')
                  onKeyDeleted()
                }}
                className="ml-auto text-white/30 hover:text-red-400/60 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Feedback Card ────────────────────────────────────────────
function FeedbackCard({ feedback, type, onSendToClaude }: {
  feedback: CriticFeedback
  type: 'plan' | 'result'
  onSendToClaude: () => void
}) {
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null)
  const vc = VERDICT_CONFIG[feedback.verdict]
  const VerdictIcon = vc.icon

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden">
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 ${vc.bg}`}>
        <VerdictIcon className={`w-4 h-4 ${vc.color}`} />
        <span className={`text-xs font-medium ${vc.color}`}>{vc.label}</span>
        <span className="text-xs text-white/40 ml-auto">{type === 'plan' ? 'Plan Review' : 'Code Review'}</span>
        {feedback.score !== undefined && (
          <span className="text-xs text-white/40 tabular-nums">{feedback.score}/100</span>
        )}
      </div>

      {/* Summary */}
      <div className="px-3 py-2 text-xs text-white/70">{feedback.summary}</div>

      {/* Issues */}
      {feedback.issues.length > 0 && (
        <div className="border-t border-white/5">
          <div className="px-3 py-1.5 text-xs text-white/40">
            Issues ({feedback.issues.length})
          </div>
          {feedback.issues.map((issue, i) => {
            const sc = SEVERITY_CONFIG[issue.severity]
            const SIcon = sc.icon
            const isExpanded = expandedIssue === i
            return (
              <div key={i} className="border-t border-white/5">
                <button
                  onClick={() => setExpandedIssue(isExpanded ? null : i)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
                >
                  <SIcon className={`w-3 h-3 flex-shrink-0 ${sc.color}`} />
                  <span className="text-xs text-white/70 truncate">{issue.description}</span>
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3 text-white/20 ml-auto flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-white/20 ml-auto flex-shrink-0" />}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2 pl-8 space-y-1">
                    {issue.file && (
                      <div className="text-xs text-white/40">
                        File: <span className="text-[#4AEAFF]/60">{issue.file}</span>
                      </div>
                    )}
                    {issue.recommendation && (
                      <div className="text-xs text-white/50">{issue.recommendation}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Strengths */}
      {feedback.strengths && feedback.strengths.length > 0 && (
        <div className="border-t border-white/5 px-3 py-2">
          <div className="text-xs text-white/40 mb-1">Strengths</div>
          {feedback.strengths.map((s, i) => (
            <div key={i} className="text-xs text-green-400/60 flex items-start gap-1.5">
              <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {s}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-white/5 px-3 py-2 flex gap-2">
        <button
          onClick={onSendToClaude}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/10 hover:bg-white/15
            rounded text-white/80 transition-colors"
        >
          <Send className="w-3 h-3" />
          Send to Claude
        </button>
      </div>
    </div>
  )
}

// ── Phase Indicator ──────────────────────────────────────────
function PhaseIndicator({ phase }: { phase: string }) {
  const isActive = ['critic_reviewing_plan', 'critic_reviewing_result', 'post_review_prep'].includes(phase)
  const isDone = phase === 'done'
  const isError = phase === 'error'

  return (
    <div className="flex items-center gap-1.5">
      {isActive && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
      {isDone && <CheckCircle className="w-3 h-3 text-green-400" />}
      {isError && <XCircle className="w-3 h-3 text-red-400" />}
      {!isActive && !isDone && !isError && <Clock className="w-3 h-3 text-white/30" />}
      <span className="text-xs text-white/50">{phase.replace(/_/g, ' ')}</span>
    </div>
  )
}

// ── Plan Preview ─────────────────────────────────────────────
function PlanPreview({ tabId, projectPath }: { tabId: string; projectPath: string }) {
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
    <div className="border border-purple-500/20 rounded-lg overflow-hidden bg-purple-500/5">
      <div className="flex items-center gap-2 px-3 py-2">
        <Eye className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-medium text-purple-300">Plan Detected</span>
        <span className="text-[10px] text-purple-400/50 ml-auto tabular-nums">
          {Math.round(pending.confidence * 100)}% confidence
        </span>
      </div>
      <div className="px-3 py-2 max-h-40 overflow-y-auto">
        <pre className="text-[11px] text-white/50 whitespace-pre-wrap font-mono leading-relaxed">
          {pending.planText.slice(0, 1000)}
          {pending.planText.length > 1000 && '...'}
        </pre>
      </div>
      <div className="border-t border-purple-500/10 px-3 py-2 flex gap-2">
        <button
          onClick={handleReview}
          disabled={reviewing}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-purple-500/20 hover:bg-purple-500/30
            rounded text-purple-300 transition-colors disabled:opacity-40"
        >
          {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Review Plan
        </button>
        <button
          onClick={() => dismissPlan(tabId)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10
            rounded text-white/50 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// ── Event Timeline ───────────────────────────────────────────
function EventTimeline({ session }: { session: CriticSession }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-white/40 px-1">
        Events ({session.events.length})
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {session.events.map((evt, i) => (
          <div key={i} className="flex items-start gap-2 px-2 py-1 text-[11px] text-white/40 hover:bg-white/5 rounded">
            <span className="text-white/20 tabular-nums flex-shrink-0">
              {new Date(evt.timestamp).toLocaleTimeString()}
            </span>
            <span className="truncate">{evt.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main CriticPanel ─────────────────────────────────────────
export function CriticPanel() {
  const currentTab = useActiveTab()
  const tabId = currentTab?.id ?? null
  const ptyId = currentTab?.ptyId ?? null
  const { currentProject } = useProjectStore()
  const projectPath = currentProject?.path ?? null

  // Subscribe to critic store — all reads via selectors for reactive updates
  const session = useCriticStore((s) => tabId ? s.activeSessions[tabId] : undefined)
  const recentSessions = useCriticStore((s) => s.recentSessions)
  const latestSession = session ?? recentSessions.find((s) => s.tabId === tabId) ?? null
  const pendingPlan = useCriticStore((s) => tabId ? s.pendingPlans[tabId] : undefined)

  // Lifted hasKey state — shared between setup prompt and settings
  const [hasKey, setHasKey] = useState(false)
  useEffect(() => {
    window.api.critic.hasApiKey().then(setHasKey)
  }, [])

  const [runningDiagnostics, setRunningDiagnostics] = useState(false)

  const sendFeedbackToClaude = useCallback((feedback: CriticFeedback, type: 'plan' | 'result') => {
    if (!ptyId) return
    const text = formatFeedbackForClaude(feedback, type)
    window.api.pty.write(ptyId, text)
  }, [ptyId])

  const [reviewError, setReviewError] = useState<string | null>(null)

  const handleRunReview = useCallback(async () => {
    if (!tabId || !projectPath) return
    setRunningDiagnostics(true)
    setReviewError(null)
    try {
      const [diagnostics, diff] = await Promise.all([
        window.api.critic.collectDiagnostics(projectPath),
        window.api.git.diff(projectPath).catch(() => ''),
      ])
      const result = await window.api.critic.reviewResult(
        tabId, projectPath, diff as string, diagnostics,
        `Project: ${projectPath}`
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

  const handleAbort = useCallback(() => {
    if (tabId) window.api.critic.abort(tabId)
  }, [tabId])

  if (!tabId || !projectPath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-white/30">
        Open a project to use the critic loop
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0A0F1A]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
        <Zap className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-medium text-white/80">Critic Loop</span>
        {latestSession && <PhaseIndicator phase={latestSession.phase} />}
        {latestSession && latestSession.iteration > 0 && (
          <span className="text-[10px] text-white/30 tabular-nums ml-auto">
            Iteration {latestSession.iteration}/{latestSession.maxIterations}
          </span>
        )}
      </div>

      {/* Setup prompt (no API key) */}
      <CriticSetupPrompt hasKey={hasKey} onKeySaved={() => setHasKey(true)} />

      {/* Settings */}
      <CriticSettings projectPath={projectPath} hasKey={hasKey} onKeyDeleted={() => setHasKey(false)} />

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Pending plan */}
        <PlanPreview tabId={tabId} projectPath={projectPath} />

        {/* No review warning when plan exists but user hasn't reviewed */}
        {pendingPlan && !session && (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/5 border border-yellow-500/10 rounded-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400/60" />
            <span className="text-xs text-yellow-400/60">Proceeding without review</span>
          </div>
        )}

        {/* Plan feedback */}
        {latestSession?.planFeedback && (
          <FeedbackCard
            feedback={latestSession.planFeedback}
            type="plan"
            onSendToClaude={() => sendFeedbackToClaude(latestSession.planFeedback!, 'plan')}
          />
        )}

        {/* Result feedback */}
        {latestSession?.resultFeedback && (
          <FeedbackCard
            feedback={latestSession.resultFeedback}
            type="result"
            onSendToClaude={() => sendFeedbackToClaude(latestSession.resultFeedback!, 'result')}
          />
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleRunReview}
            disabled={runningDiagnostics || (session?.phase === 'critic_reviewing_result')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15
              rounded-md text-white/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {runningDiagnostics ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run Code Review
          </button>
          {session && (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20
                rounded-md text-red-400/80 transition-colors"
            >
              <Square className="w-3 h-3" />
              Abort
            </button>
          )}
        </div>

        {/* Event timeline */}
        {latestSession && latestSession.events.length > 0 && (
          <EventTimeline session={latestSession} />
        )}

        {/* Local review error */}
        {reviewError && (
          <div className="px-3 py-2 bg-red-500/5 border border-red-500/10 rounded-lg">
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <XCircle className="w-3 h-3" />
              Review Failed
            </div>
            <div className="text-xs text-red-400/60 mt-1">{reviewError}</div>
          </div>
        )}

        {/* Error display */}
        {latestSession?.error && (
          <div className="px-3 py-2 bg-red-500/5 border border-red-500/10 rounded-lg">
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <XCircle className="w-3 h-3" />
              Error
            </div>
            <div className="text-xs text-red-400/60 mt-1">{latestSession.error}</div>
          </div>
        )}

        {/* Empty state */}
        {!latestSession && !pendingPlan && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Zap className="w-8 h-8 text-white/10 mb-3" />
            <p className="text-xs text-white/30 max-w-xs">
              The critic loop reviews plans and implementations via OpenAI.
              Enable it in settings and start a Claude session.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
