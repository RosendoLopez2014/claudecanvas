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

// ── Viewport Presets ───────────────────────────────────────
export const VIEWPORT_PRESETS = [
  { label: 'Responsive', width: 0 },
  { label: 'iPhone SE', width: 375 },
  { label: 'iPhone 14', width: 390 },
  { label: 'iPhone Pro Max', width: 430 },
  { label: 'iPad Mini', width: 768 },
  { label: 'iPad', width: 1024 },
  { label: 'Laptop', width: 1280 },
  { label: 'Desktop', width: 1440 },
] as const

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
