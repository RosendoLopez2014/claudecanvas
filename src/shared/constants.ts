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

// ── Git ────────────────────────────────────────────────────
/** Interval between automatic git fetch calls (3 minutes) */
export const GIT_FETCH_INTERVAL_MS = 180_000
