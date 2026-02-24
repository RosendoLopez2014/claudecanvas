/**
 * Dev Server Resolver — local-first, deterministic command resolution.
 *
 * Resolves the correct dev server command for a project in ~1ms with no
 * external dependencies. Falls back gracefully when unsure (low confidence).
 *
 * Resolution order:
 *   1. User override (explicit user choice)
 *   2. LastKnownGood (previously worked, validated still exists)
 *   3. Framework detection (package.json deps + config files)
 *   4. Generic script detection (dev, start, develop, serve)
 *   5. Low-confidence fallback (returns plan with confidence: 'low')
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import type {
  DevServerPlan,
  SafeCommand,
  PackageManager,
  Confidence,
  PersistedDevConfig,
  ValidationResult,
} from '../../shared/devserver/types'
import { validatePlan, extractScriptName } from '../../shared/devserver/types'
import { getDevConfig } from './config-store'

// ── Logging ───────────────────────────────────────────────────────
function log(cwd: string, msg: string) {
  console.log(`[devserver] RESOLVE [${basename(cwd)}] ${msg}`)
}

// ── Package.json shape ────────────────────────────────────────────
interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
  packageManager?: string
}

// ── Framework patterns ────────────────────────────────────────────
const FRAMEWORK_PATTERNS: Array<{
  id: string
  packages: string[]
  preferScript: string
  devPort: number
  configFiles?: string[]
}> = [
  { id: 'nextjs', packages: ['next'], preferScript: 'dev', devPort: 3000, configFiles: ['next.config.js', 'next.config.ts', 'next.config.mjs'] },
  { id: 'nuxt', packages: ['nuxt'], preferScript: 'dev', devPort: 3000, configFiles: ['nuxt.config.ts', 'nuxt.config.js'] },
  { id: 'remix', packages: ['@remix-run/react', '@remix-run/dev'], preferScript: 'dev', devPort: 5173 },
  { id: 'astro', packages: ['astro'], preferScript: 'dev', devPort: 4321, configFiles: ['astro.config.mjs', 'astro.config.ts'] },
  { id: 'sveltekit', packages: ['@sveltejs/kit'], preferScript: 'dev', devPort: 5173, configFiles: ['svelte.config.js'] },
  { id: 'vite', packages: ['vite'], preferScript: 'dev', devPort: 5173, configFiles: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'] },
  { id: 'gatsby', packages: ['gatsby'], preferScript: 'develop', devPort: 8000 },
  { id: 'cra', packages: ['react-scripts'], preferScript: 'start', devPort: 3000 },
  { id: 'angular', packages: ['@angular/core', '@angular/cli'], preferScript: 'start', devPort: 4200, configFiles: ['angular.json'] },
  { id: 'vue', packages: ['vue', '@vue/cli-service'], preferScript: 'dev', devPort: 5173 },
  { id: 'express', packages: ['express'], preferScript: 'dev', devPort: 3000 },
  { id: 'nestjs', packages: ['@nestjs/core'], preferScript: 'start:dev', devPort: 3000 },
]

// ── Package Manager Detection ─────────────────────────────────────
export function detectPackageManager(projectPath: string): PackageManager {
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) return 'bun'
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/** Build a SafeCommand for `<pm> run <script>` or `<pm> <script>`. */
function buildRunCommand(pm: PackageManager, script: string): SafeCommand {
  if (script === 'start') return { bin: pm, args: ['start'] }
  if (pm === 'yarn' || pm === 'pnpm') return { bin: pm, args: [script] }
  return { bin: pm, args: ['run', script] }
}

// ── Port from .env ────────────────────────────────────────────────
function readPortFromEnv(cwd: string): number | undefined {
  for (const name of ['.env', '.env.local', '.env.development']) {
    const envPath = join(cwd, name)
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8')
        const match = content.match(/^PORT\s*=\s*(\d+)/m)
        if (match) return parseInt(match[1], 10)
      } catch { /* ignore */ }
    }
  }
  return undefined
}

// ── Monorepo Workspace Detection ──────────────────────────────────
function findWorkspaceCwd(rootPath: string, _targetDir: string): string | null {
  try {
    const rootPkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8')) as PackageJson
    const workspaces = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces?.packages

    if (!workspaces || workspaces.length === 0) return null

    // Check each workspace for a dev script
    for (const ws of workspaces) {
      const wsBase = ws.replace(/\/\*$/, '') // strip glob
      const wsPath = join(rootPath, wsBase)
      if (!existsSync(wsPath)) continue

      const wsPkgPath = join(wsPath, 'package.json')
      if (existsSync(wsPkgPath)) {
        try {
          const wsPkg = JSON.parse(readFileSync(wsPkgPath, 'utf-8')) as PackageJson
          if (wsPkg.scripts?.dev || wsPkg.scripts?.start) {
            return wsPath
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return null
}

// ── Main Resolver ─────────────────────────────────────────────────

export function resolveDevServerPlan(projectPath: string): DevServerPlan {
  const reasons: string[] = []
  const config = getDevConfig(projectPath)

  // ── 1. User override ───────────────────────────────────────────
  if (config?.userOverride) {
    log(projectPath, 'Using user override')
    reasons.push('User-configured command')

    // Validate that referenced script still exists in package.json
    const overrideScript = extractScriptName(config.userOverride.command)
    let scriptValid = true
    if (overrideScript) {
      try {
        const pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8')) as PackageJson
        if (!pkg.scripts?.[overrideScript]) {
          reasons.push(`User override script "${overrideScript}" no longer exists in package.json`)
          scriptValid = false
        }
      } catch {
        // Can't read package.json — still use override (might not be a script-based command)
      }
    }

    if (scriptValid) {
      const plan: DevServerPlan = {
        cwd: projectPath,
        manager: config.userOverride.command.bin as PackageManager,
        command: config.userOverride.command,
        port: config.userOverride.port,
        confidence: 'high',
        reasons,
        detection: { usedLastKnownGood: false },
      }
      const v = validatePlan(plan)
      if (v.ok) return plan
      reasons.push(`User override failed validation: ${v.error}`)
    }
  }

  // ── 2. LastKnownGood ───────────────────────────────────────────
  if (config?.lastKnownGood) {
    const lkg = config.lastKnownGood
    // Validate that the script still exists in package.json
    // Use spawnCwd if set (for nested project directories)
    const lkgCheckPath = lkg.spawnCwd || projectPath
    if (lkg.scriptName) {
      try {
        const pkg = JSON.parse(readFileSync(join(lkgCheckPath, 'package.json'), 'utf-8')) as PackageJson
        if (pkg.scripts?.[lkg.scriptName]) {
          log(projectPath, `Using LastKnownGood: ${lkg.command.bin} ${lkg.command.args.join(' ')}${lkg.spawnCwd ? ` (in ${basename(lkg.spawnCwd)})` : ''}`)
          reasons.push(`LastKnownGood (script "${lkg.scriptName}" still exists)`)
          const plan: DevServerPlan = {
            cwd: projectPath,
            spawnCwd: lkg.spawnCwd,
            manager: lkg.command.bin as PackageManager,
            command: lkg.command,
            port: lkg.port,
            confidence: 'high',
            reasons,
            detection: { framework: lkg.framework, script: lkg.scriptName, usedLastKnownGood: true },
          }
          const v = validatePlan(plan)
          if (v.ok) return plan
          reasons.push(`LastKnownGood failed validation: ${v.error}`)
        } else {
          reasons.push(`LastKnownGood script "${lkg.scriptName}" no longer exists in package.json`)
        }
      } catch {
        reasons.push('Could not read package.json to validate LastKnownGood')
      }
    }
  }

  // ── 3. Framework detection ─────────────────────────────────────
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, 'utf-8')
      const pkg: PackageJson = JSON.parse(raw)
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const pm = detectPackageManager(projectPath)
      const scripts = pkg.scripts || {}
      const envPort = readPortFromEnv(projectPath)

      // Match known frameworks
      for (const pattern of FRAMEWORK_PATTERNS) {
        if (pattern.packages.some((p) => p in allDeps)) {
          // Find the best script
          let scriptName = pattern.preferScript
          if (!(scriptName in scripts)) {
            if ('dev' in scripts) scriptName = 'dev'
            else if ('start' in scripts) scriptName = 'start'
            else if ('develop' in scripts) scriptName = 'develop'
            else {
              reasons.push(`Framework ${pattern.id} detected but no matching script found`)
              continue
            }
          }

          const port = envPort ?? pattern.devPort
          log(projectPath, `Framework detected: ${pattern.id} → ${pm} run ${scriptName} (port ${port})`)
          reasons.push(`Detected framework: ${pattern.id}`)
          reasons.push(`Using script: "${scriptName}"`)

          return {
            cwd: projectPath,
            manager: pm,
            command: buildRunCommand(pm, scriptName),
            port,
            confidence: 'high',
            reasons,
            detection: { framework: pattern.id, script: scriptName },
          }
        }
      }

      // ── 4. Generic script detection ────────────────────────────
      const scriptPriority = ['dev', 'start', 'develop', 'serve']
      for (const s of scriptPriority) {
        if (s in scripts) {
          const port = envPort ?? 3000
          log(projectPath, `Generic script found: "${s}" → ${pm} run ${s}`)
          reasons.push(`No known framework, using script: "${s}"`)
          return {
            cwd: projectPath,
            manager: pm,
            command: buildRunCommand(pm, s),
            port,
            confidence: 'medium',
            reasons,
            detection: { framework: 'node', script: s },
          }
        }
      }

      // ── 4b. Monorepo check ─────────────────────────────────────
      const wsCwd = findWorkspaceCwd(projectPath, projectPath)
      if (wsCwd && wsCwd !== projectPath) {
        log(projectPath, `Monorepo: delegating to workspace ${basename(wsCwd)}`)
        const wsPlan = resolveDevServerPlan(wsCwd)
        return {
          ...wsPlan,
          reasons: [...reasons, `Monorepo: resolved from workspace ${basename(wsCwd)}`, ...wsPlan.reasons],
          detection: { ...wsPlan.detection, usedMonorepoWorkspace: true },
        }
      }

      // Has scripts but none matched
      if (Object.keys(scripts).length > 0) {
        reasons.push(`Has ${Object.keys(scripts).length} scripts but none match dev patterns`)
        return {
          cwd: projectPath,
          manager: pm,
          command: buildRunCommand(pm, Object.keys(scripts)[0]),
          port: envPort ?? 3000,
          confidence: 'low',
          reasons,
          detection: { framework: 'node' },
        }
      }

      // No scripts at all
      reasons.push('package.json has no scripts')
    } catch (err) {
      reasons.push(`Failed to parse package.json: ${err}`)
    }
  }

  // ── 4c. Subdirectory scan ───────────────────────────────────────
  // When the root has no usable scripts, check immediate subdirectories
  // for a nested project with dev scripts (e.g. landio-clone/, app/, client/).
  try {
    const entries = readdirSync(projectPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const subPkgPath = join(projectPath, entry.name, 'package.json')
      if (!existsSync(subPkgPath)) continue
      try {
        const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf-8')) as PackageJson
        const subScripts = subPkg.scripts || {}
        const devScripts = ['dev', 'start', 'develop', 'serve']
        const found = devScripts.find((s) => s in subScripts)
        if (found) {
          const subPath = join(projectPath, entry.name)
          log(projectPath, `Subdirectory project found: ${entry.name}/ → delegating`)
          reasons.push(`Found dev script "${found}" in subdirectory ${entry.name}/`)
          const subPlan = resolveDevServerPlan(subPath)
          return {
            ...subPlan,
            reasons: [...reasons, ...subPlan.reasons],
            detection: { ...subPlan.detection, usedMonorepoWorkspace: true },
          }
        }
      } catch { /* skip unparseable */ }
    }
  } catch { /* can't read directory */ }

  // ── Non-Node projects ──────────────────────────────────────────
  if (existsSync(join(projectPath, 'docker-compose.yml')) || existsSync(join(projectPath, 'docker-compose.yaml'))) {
    reasons.push('Docker Compose project detected')
    // Docker isn't in the allowlist — return low confidence
    return {
      cwd: projectPath,
      manager: 'npm',
      command: { bin: 'npm', args: ['run', 'dev'] }, // placeholder
      confidence: 'low',
      reasons: [...reasons, 'Docker projects need manual configuration'],
      detection: { framework: 'docker' },
    }
  }

  // ── 5. Low-confidence fallback ─────────────────────────────────
  const pm = detectPackageManager(projectPath)
  reasons.push('Could not determine dev command — needs manual configuration')
  return {
    cwd: projectPath,
    manager: pm,
    command: buildRunCommand(pm, 'dev'),
    confidence: 'low',
    reasons,
    detection: {},
  }
}

/**
 * Check if verification should run for this plan.
 * Returns true when:
 * - Confidence is 'low'
 * - Last attempt failed
 * - package.json has been modified since LastKnownGood was set
 */
export function needsVerification(plan: DevServerPlan, config: PersistedDevConfig | null): boolean {
  if (plan.confidence === 'low') return true

  if (config?.lastFailure) {
    // If last failure was within 5 minutes, suggest verification
    if (Date.now() - config.lastFailure.timestamp < 5 * 60 * 1000) return true
  }

  // TODO: check package.json mtime vs lastKnownGood.updatedAt
  return false
}
