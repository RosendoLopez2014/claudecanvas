// ── Dev Server Plan Types ─────────────────────────────────────────
// Strict types for the proactive dev server resolver.
// Commands are NEVER stored as single strings — always as { bin, args }.

/** Allowlisted package manager binaries. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** Allowlisted command binaries (package managers + common runtimes). */
export const ALLOWED_BINS = new Set<string>([
  'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx',
])

/** Characters that are NEVER permitted in args (shell metacharacters). */
const FORBIDDEN_CHARS = /[;|&><$`\n\\]/

/** Forbidden full-word patterns (dangerous binaries). */
const FORBIDDEN_WORDS = new Set(['curl', 'wget', 'bash', 'sh', 'zsh', 'fish', 'rm', 'sudo'])

/** How confident the resolver is in the computed plan. */
export type Confidence = 'high' | 'medium' | 'low'

/** A safe, pre-validated command to spawn. Never a raw string. */
export interface SafeCommand {
  bin: string    // must be in ALLOWED_BINS
  args: string[] // each arg validated against FORBIDDEN_CHARS
}

/** Metadata about how the plan was determined. */
export interface DetectionMeta {
  framework?: string
  script?: string
  usedLastKnownGood?: boolean
  usedMonorepoWorkspace?: boolean
  verifiedByClaude?: boolean
}

/** The complete plan for starting a dev server. */
export interface DevServerPlan {
  cwd: string
  /** When the dev project lives in a subdirectory, spawnCwd is the actual
   *  directory to spawn in. cwd remains the project root for tracking/status. */
  spawnCwd?: string
  manager: PackageManager
  command: SafeCommand
  port?: number
  host?: string
  confidence: Confidence
  reasons: string[]
  detection: DetectionMeta
}

/** Persisted per-project config in electron-store. */
export interface PersistedDevConfig {
  /** Last command that successfully started and reached "ready". */
  lastKnownGood?: {
    command: SafeCommand
    port?: number
    framework?: string
    /** Script name from package.json (to verify still exists). */
    scriptName?: string
    /** Subdirectory where the script lives (when different from project root). */
    spawnCwd?: string
    updatedAt: number
  }
  /** Last failure info (for triggering verification). */
  lastFailure?: {
    error: string
    timestamp: number
  }
  /** User's explicit override (from CommandPicker or settings). */
  userOverride?: {
    command: SafeCommand
    port?: number
    setAt: number
  }
}

/** Result of plan validation. */
export interface ValidationResult {
  ok: boolean
  error?: string
}

// ── Validation ────────────────────────────────────────────────────

/** Validate that a bin is in the allowlist. */
export function isAllowedBin(bin: string): boolean {
  return ALLOWED_BINS.has(bin)
}

/** Validate that an arg does not contain shell metacharacters. */
export function isCleanArg(arg: string): boolean {
  if (FORBIDDEN_CHARS.test(arg)) return false
  // Check if the arg itself is a forbidden command
  const word = arg.toLowerCase().trim()
  if (FORBIDDEN_WORDS.has(word)) return false
  return true
}

/** Validate a SafeCommand: bin in allowlist, args clean. */
export function validateCommand(cmd: SafeCommand): ValidationResult {
  if (!isAllowedBin(cmd.bin)) {
    return { ok: false, error: `Binary "${cmd.bin}" is not in the allowlist: ${[...ALLOWED_BINS].join(', ')}` }
  }
  for (const arg of cmd.args) {
    if (!isCleanArg(arg)) {
      return { ok: false, error: `Argument "${arg}" contains forbidden characters or patterns` }
    }
  }
  return { ok: true }
}

/** Validate an entire DevServerPlan. */
export function validatePlan(plan: DevServerPlan): ValidationResult {
  // Validate command
  const cmdResult = validateCommand(plan.command)
  if (!cmdResult.ok) return cmdResult

  // Validate cwd is absolute
  if (!plan.cwd || !plan.cwd.startsWith('/')) {
    return { ok: false, error: `cwd must be an absolute path, got: "${plan.cwd}"` }
  }

  // Validate port range if specified
  if (plan.port !== undefined && (plan.port < 1 || plan.port > 65535)) {
    return { ok: false, error: `Port ${plan.port} is out of range (1-65535)` }
  }

  return { ok: true }
}

// ── Script Extraction ─────────────────────────────────────────────

/**
 * Extract the package.json script name from a SafeCommand, if it references one.
 *
 * Examples:
 *   { bin: 'npm', args: ['run', 'dev'] }   → 'dev'
 *   { bin: 'yarn', args: ['dev'] }          → 'dev'
 *   { bin: 'npm', args: ['start'] }         → 'start'
 *   { bin: 'npx', args: ['vite'] }          → null (not a script ref)
 *   { bin: 'node', args: ['server.js'] }    → null (not a script ref)
 */
export function extractScriptName(cmd: SafeCommand): string | null {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(cmd.bin)) return null
  if (cmd.args.length === 0) return null

  // Explicit `<pm> run <script>` pattern
  if (cmd.args[0] === 'run' && cmd.args.length >= 2) return cmd.args[1]

  // Direct script invocation: `npm start`, `yarn dev`, etc.
  // Exclude known PM subcommands that aren't script references.
  const PM_SUBCOMMANDS = new Set([
    'install', 'i', 'ci', 'init', 'publish', 'pack', 'link', 'unlink',
    'add', 'remove', 'upgrade', 'update', 'exec', 'dlx', 'create',
    'x', 'cache', 'config', 'set', 'get', 'info', 'why', 'ls', 'list',
    'outdated', 'prune', 'rebuild', 'audit', 'fund', 'login', 'logout',
    'whoami', 'version', 'help', 'bin', 'prefix', 'root',
  ])
  if (!PM_SUBCOMMANDS.has(cmd.args[0])) return cmd.args[0]

  return null
}

// ── Conversion Helpers ────────────────────────────────────────────

/**
 * Parse a user-provided command string into a SafeCommand.
 * Returns null if validation fails.
 */
export function parseCommandString(raw: string): SafeCommand | null {
  const parts = raw.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return null

  const bin = parts[0]
  const args = parts.slice(1)

  const cmd: SafeCommand = { bin, args }
  const result = validateCommand(cmd)
  return result.ok ? cmd : null
}

/**
 * Convert a SafeCommand back to a display string (for UI only, never for exec).
 */
export function commandToString(cmd: SafeCommand): string {
  return [cmd.bin, ...cmd.args].join(' ')
}
