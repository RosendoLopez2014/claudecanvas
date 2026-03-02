export type CriticPhase =
  | 'idle' | 'plan_detected'
  | 'critic_reviewing_plan' | 'plan_feedback_ready'
  | 'executing' | 'post_review_prep'
  | 'critic_reviewing_result' | 'result_feedback_ready'
  | 'done' | 'paused' | 'aborted' | 'error'

export const TERMINAL_CRITIC_PHASES: ReadonlySet<CriticPhase> = new Set([
  'done', 'aborted', 'error',
])

export interface CriticIssue {
  severity: 'critical' | 'major' | 'minor' | 'suggestion'
  description: string
  file?: string
  recommendation?: string
}

export interface CriticFeedback {
  verdict: 'approve' | 'revise' | 'reject'
  summary: string
  issues: CriticIssue[]
  strengths?: string[]
  score?: number // 0-100
}

export interface CriticRunArtifact {
  runId: string
  tabId: string
  projectPath: string
  startedAt: number
  phase: CriticPhase
  plan?: string
  planFeedback?: CriticFeedback
  resultFeedback?: CriticFeedback
  diagnostics?: CriticDiagnostics
  gitDiff?: string
  iteration: number
  maxIterations: number
}

export interface CriticDiagnostics {
  tscOutput?: string
  testOutput?: string
  buildOutput?: string
  previewErrors?: string[]
}

export interface CriticEvent {
  runId: string
  tabId: string
  projectPath: string
  phase: CriticPhase
  message: string
  timestamp: number
  feedback?: CriticFeedback
  diagnostics?: CriticDiagnostics
  iteration?: number
  maxIterations?: number
  error?: string
}

export interface PlanDetectedEvent {
  tabId: string
  projectPath: string
  planText: string
  confidence: number
}

export interface CriticConfig {
  enabled: boolean
  model: string
  maxIterations: number
  autoReviewPlan: boolean
  gateMode: 'recommended' | 'strict'
  planDetectionKeywords: string[]
}

export const DEFAULT_CRITIC_CONFIG: CriticConfig = {
  enabled: false,
  model: 'gpt-5.2',
  maxIterations: 3,
  autoReviewPlan: false,
  gateMode: 'recommended',
  planDetectionKeywords: [
    'plan:', 'implementation plan', 'approach:', 'steps:',
    "here's what i'll do", 'i will:', 'strategy:',
  ],
}

export type GateStatus = 'open' | 'gated' | 'overridden'

export interface GateState {
  projectPath: string
  status: GateStatus
  reason: string
  gatedAt: number
  overriddenBy?: string // 'user' | 'critic_approve' | 'error'
}

export interface GateEvent {
  projectPath: string
  status: GateStatus
  reason: string
  timestamp: number
}
