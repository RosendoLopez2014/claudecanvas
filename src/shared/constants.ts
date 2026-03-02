// ── Debug ──────────────────────────────────────────────────
/**
 * Runtime debug flag. Evaluates to true in dev mode (Vite HMR / electron-vite dev)
 * and false in production builds. Gate all noisy console.log calls behind this.
 *
 * Usage:
 *   import { DEBUG } from '@shared/constants'   // renderer (Vite alias)
 *   import { DEBUG } from '../../shared/constants'  // main/preload
 *   if (DEBUG) console.log('[subsystem]', ...)
 */
export const DEBUG =
  typeof process !== 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : false

// ── PTY ────────────────────────────────────────────────────
/** Batch interval for PTY output buffering (~120fps) */
export const PTY_BUFFER_BATCH_MS = 8

// ── Inline Rendering ───────────────────────────────────────
/** Max width (px) for a component to render inline in the terminal */
export const INLINE_MAX_WIDTH = 400
/** Max height (px) for a component to render inline in the terminal */
export const INLINE_MAX_HEIGHT = 200

// ── OAuth ──────────────────────────────────────────────────
/** Timeout for OAuth device/PKCE flows (10 minutes) */
export const OAUTH_TIMEOUT_MS = 600_000

// ── Dev Server ─────────────────────────────────────────────
/** Max time to wait for a dev server to emit a URL before giving up */
export const DEV_SERVER_STARTUP_TIMEOUT_MS = 20_000
/** After stdout timeout, probe these common ports via HTTP HEAD */
export const DEV_SERVER_PROBE_PORTS = [3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8888]
/** Crash loop: max crashes within the window before refusing restart */
export const CRASH_LOOP_MAX = 3
/** Crash loop: sliding window in ms (60 seconds) */
export const CRASH_LOOP_WINDOW_MS = 60_000
/** Timeout for SIGTERM before escalating to SIGKILL (5 seconds) */
export const DEV_KILL_TIMEOUT_MS = 5_000

// ── Self-Healing Loop ─────────────────────────────────────
/** Max restart attempts before giving up */
export const REPAIR_MAX_ATTEMPTS = 3
/** Base delay (ms) for exponential backoff between restart attempts */
export const REPAIR_BASE_DELAY_MS = 2000
/** Health check timeout per probe (ms) */
export const REPAIR_HEALTH_TIMEOUT_MS = 5000
/** Health check retries after restart */
export const REPAIR_HEALTH_RETRIES = 3
/** Delay between health check retries (ms) */
export const REPAIR_HEALTH_RETRY_DELAY_MS = 1000

// ── Agent Repair (Self-Healing Loop v2) ──────────────────
/** Max time to wait for Claude Code to engage before treating as transient crash */
export const AGENT_ENGAGE_TIMEOUT_MS = 30_000
/** Max time to wait for agent to finish writing files after engaging */
export const AGENT_WRITE_TIMEOUT_MS = 120_000
/** Quiet period after agent writes files before restarting (let HMR/watchers settle) */
export const REPAIR_QUIET_PERIOD_MS = 2_000
/** Max files the agent can change in one repair (safety gate) */
export const REPAIR_MAX_FILES = 8
/** Max lines of code the agent can change in one repair (safety gate) */
export const REPAIR_MAX_LOC = 300
/** Cooldown period after all attempts exhausted (10 minutes) */
export const REPAIR_COOLDOWN_MS = 600_000

// ── Power Monitor ─────────────────────────────────────────
/** Delay after system resume before running health checks (let OS settle) */
export const RESUME_HEALTH_CHECK_DELAY_MS = 2_000
/** Delay after resume before PTY reconnect attempt in renderer */
export const RESUME_PTY_RECONNECT_DELAY_MS = 1_500

// ── Viewport Presets ───────────────────────────────────────
export const VIEWPORT_PRESETS = [
  { label: 'Responsive', width: 0, device: 'none' as const },
  { label: 'Mobile', width: 390, device: 'mobile' as const },
  { label: 'Tablet', width: 768, device: 'tablet' as const },
  { label: 'Desktop', width: 1440, device: 'none' as const },
]

export type DeviceType = 'none' | 'mobile' | 'tablet'

// ── Git ────────────────────────────────────────────────────
/** Interval between automatic git fetch calls (3 minutes) */
export const GIT_FETCH_INTERVAL_MS = 180_000

/** Push workflow profiles */
export type GitPushMode = 'solo' | 'team' | 'contributor'

export const GIT_PUSH_MODES: Record<GitPushMode, {
  label: string
  description: string
  squash: boolean | 'feature-only'
  forceAllowed: boolean | 'feature-only'
  protectedBranches: string[]
  suggestPR: boolean
}> = {
  solo: {
    label: 'Solo Dev',
    description: 'Squash checkpoints into one commit, force push anywhere. Best for personal projects.',
    squash: true,
    forceAllowed: true,
    protectedBranches: [],
    suggestPR: false,
  },
  team: {
    label: 'Team',
    description: 'Regular push, no squashing or force push. Pull before push. Standard collaborative flow.',
    squash: false,
    forceAllowed: false,
    protectedBranches: ['main', 'master'],
    suggestPR: true,
  },
  contributor: {
    label: 'Contributor',
    description: 'Squash on feature branches, never force push main. Always suggests creating a PR.',
    squash: 'feature-only',
    forceAllowed: 'feature-only',
    protectedBranches: ['main', 'master'],
    suggestPR: true,
  },
}

// ── Critic Loop ──────────────────────────────────────────
export const CRITIC_PLAN_DETECT_DEBOUNCE_MS = 2000
export const CRITIC_PTY_BUFFER_MAX = 50_000
export const CRITIC_API_TIMEOUT_MS = 60_000
export const CRITIC_MAX_DIFF_SIZE = 100_000
export const CRITIC_JSON_RETRY_COUNT = 1

// ── Critic Gate ──────────────────────────────────────────

/** MCP tools that require critic approval when gate is active */
export const GATED_MCP_TOOLS = new Set([
  'canvas_render', 'canvas_start_preview', 'canvas_stop_preview',
  'canvas_set_preview_url', 'canvas_open_tab', 'canvas_add_to_gallery',
  'canvas_update_variant', 'canvas_checkpoint', 'canvas_notify',
  'canvas_design_session', 'configure_dev_server', 'supabase_run_sql',
])

/**
 * Native tools to KEEP in settings.local.json when gated (inverted allowlist).
 * Everything NOT in this list gets removed during gate restriction.
 * Safer than enumerating dangerous commands — we only allow known-safe reads.
 *
 * Includes read-only shell commands so Claude can still explore code while gated.
 */
export const GATED_MODE_ALLOWED_NATIVE = [
  'Read',
  'Bash(ls *)',
  'Bash(cat *)',
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git log*)',
  'Bash(git show*)',
  'Bash(grep *)',
  'Bash(rg *)',
  'Bash(find *)',
]

/** Critic MCP tool IDs (centralized for registration + allowlist) */
export const CRITIC_TOOL_IDS = [
  'mcp__claude-canvas__critic_review_plan',
  'mcp__claude-canvas__critic_review_result',
  'mcp__claude-canvas__critic_status',
  'mcp__claude-canvas__critic_override',
] as const
