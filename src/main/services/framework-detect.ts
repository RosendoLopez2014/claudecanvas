import { ipcMain } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ── Public types ────────────────────────────────────────────────────
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export interface FrameworkInfo {
  framework: string
  devCommand: string
  devPort: number
  packageManager: PackageManager
  /** Where the command came from — for logging/debugging. */
  source: 'framework-pattern' | 'script-fallback' | 'non-node'
  /** Suggested alternatives the user can pick from. */
  suggestions: string[]
}

// ── Package.json shape ──────────────────────────────────────────────
interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

// ── Framework patterns ──────────────────────────────────────────────
const FRAMEWORK_PATTERNS: Array<{
  id: string
  packages: string[]
  /** Script name to prefer (e.g. 'dev', 'start') */
  preferScript: string
  devPort: number
}> = [
  { id: 'nextjs', packages: ['next'], preferScript: 'dev', devPort: 3000 },
  { id: 'nuxt', packages: ['nuxt'], preferScript: 'dev', devPort: 3000 },
  { id: 'remix', packages: ['@remix-run/react'], preferScript: 'dev', devPort: 5173 },
  { id: 'astro', packages: ['astro'], preferScript: 'dev', devPort: 4321 },
  { id: 'sveltekit', packages: ['@sveltejs/kit'], preferScript: 'dev', devPort: 5173 },
  { id: 'vite', packages: ['vite'], preferScript: 'dev', devPort: 5173 },
  { id: 'gatsby', packages: ['gatsby'], preferScript: 'develop', devPort: 8000 },
  { id: 'cra', packages: ['react-scripts'], preferScript: 'start', devPort: 3000 },
  { id: 'angular', packages: ['@angular/core'], preferScript: 'start', devPort: 4200 },
  { id: 'vue', packages: ['vue'], preferScript: 'dev', devPort: 5173 },
]

// ── Package manager detection ───────────────────────────────────────
export function detectPackageManager(projectPath: string): PackageManager {
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) return 'bun'
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/** Build a run command for a given package manager and script name. */
function runCmd(pm: PackageManager, script: string): string {
  // yarn and pnpm allow `yarn dev` / `pnpm dev` without `run`
  // npm and bun need `npm run dev` / `bun run dev`
  if (script === 'start') return `${pm} start` // universal
  if (pm === 'yarn' || pm === 'pnpm') return `${pm} ${script}`
  return `${pm} run ${script}`
}

/** Build suggestions list: every available script that looks like a dev command. */
function buildSuggestions(pm: PackageManager, scripts: Record<string, string>): string[] {
  const devScripts = ['dev', 'start', 'develop', 'serve', 'preview']
  return devScripts
    .filter((s) => s in scripts)
    .map((s) => runCmd(pm, s))
}

// ── Main detection ──────────────────────────────────────────────────
export function detectFramework(projectPath: string): FrameworkInfo | null {
  // ── Node.js projects ──────────────────────────────────────────────
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, 'utf-8')
      const pkg: PackageJson = JSON.parse(raw)
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const pm = detectPackageManager(projectPath)
      const scripts = pkg.scripts || {}
      const suggestions = buildSuggestions(pm, scripts)

      // Match known frameworks
      for (const pattern of FRAMEWORK_PATTERNS) {
        if (pattern.packages.some((p) => p in allDeps)) {
          // Pick the best script: prefer the framework's preferred, then fallbacks
          let scriptName = pattern.preferScript
          if (!(scriptName in scripts)) {
            if ('dev' in scripts) scriptName = 'dev'
            else if ('start' in scripts) scriptName = 'start'
            else if ('develop' in scripts) scriptName = 'develop'
          }
          return {
            framework: pattern.id,
            devCommand: runCmd(pm, scriptName),
            devPort: pattern.devPort,
            packageManager: pm,
            source: 'framework-pattern',
            suggestions,
          }
        }
      }

      // Generic Node project — pick first available dev-like script
      if ('dev' in scripts) {
        return { framework: 'node', devCommand: runCmd(pm, 'dev'), devPort: 3000, packageManager: pm, source: 'script-fallback', suggestions }
      }
      if ('start' in scripts) {
        return { framework: 'node', devCommand: runCmd(pm, 'start'), devPort: 3000, packageManager: pm, source: 'script-fallback', suggestions }
      }
      if ('develop' in scripts) {
        return { framework: 'node', devCommand: runCmd(pm, 'develop'), devPort: 3000, packageManager: pm, source: 'script-fallback', suggestions }
      }
      if ('serve' in scripts) {
        return { framework: 'node', devCommand: runCmd(pm, 'serve'), devPort: 3000, packageManager: pm, source: 'script-fallback', suggestions }
      }

      // Has package.json but no recognized dev scripts — return all available scripts as suggestions
      if (Object.keys(scripts).length > 0) {
        const allSuggestions = Object.keys(scripts).map((s) => runCmd(pm, s))
        return { framework: 'node', devCommand: '', devPort: 3000, packageManager: pm, source: 'script-fallback', suggestions: allSuggestions }
      }
    } catch {
      // Invalid JSON or read error — fall through to non-Node detection
    }
  }

  // ── Non-Node projects ─────────────────────────────────────────────
  // Docker
  if (existsSync(join(projectPath, 'docker-compose.yml')) || existsSync(join(projectPath, 'docker-compose.yaml'))) {
    return {
      framework: 'docker',
      devCommand: 'docker compose up',
      devPort: 3000,
      packageManager: 'npm',
      source: 'non-node',
      suggestions: ['docker compose up', 'docker compose up --build'],
    }
  }

  // Rust / Cargo
  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    return {
      framework: 'rust',
      devCommand: 'cargo run',
      devPort: 8080,
      packageManager: 'npm',
      source: 'non-node',
      suggestions: ['cargo run', 'cargo watch -x run'],
    }
  }

  // Go
  if (existsSync(join(projectPath, 'go.mod'))) {
    return {
      framework: 'go',
      devCommand: 'go run .',
      devPort: 8080,
      packageManager: 'npm',
      source: 'non-node',
      suggestions: ['go run .', 'go run main.go'],
    }
  }

  // Python — Django
  if (existsSync(join(projectPath, 'manage.py'))) {
    return {
      framework: 'django',
      devCommand: 'python manage.py runserver',
      devPort: 8000,
      packageManager: 'npm',
      source: 'non-node',
      suggestions: ['python manage.py runserver', 'python manage.py runserver 0.0.0.0:8000'],
    }
  }

  // Python — Flask / FastAPI (pyproject.toml or requirements.txt)
  if (existsSync(join(projectPath, 'pyproject.toml')) || existsSync(join(projectPath, 'requirements.txt'))) {
    // Check for common entrypoints
    if (existsSync(join(projectPath, 'app.py'))) {
      return {
        framework: 'flask',
        devCommand: 'flask run',
        devPort: 5000,
        packageManager: 'npm',
        source: 'non-node',
        suggestions: ['flask run', 'python app.py', 'uvicorn app:app --reload'],
      }
    }
    if (existsSync(join(projectPath, 'main.py'))) {
      return {
        framework: 'python',
        devCommand: 'python main.py',
        devPort: 8000,
        packageManager: 'npm',
        source: 'non-node',
        suggestions: ['python main.py', 'uvicorn main:app --reload'],
      }
    }
  }

  // Makefile with dev target
  if (existsSync(join(projectPath, 'Makefile'))) {
    try {
      const makefile = readFileSync(join(projectPath, 'Makefile'), 'utf-8')
      if (/^dev\s*:/m.test(makefile)) {
        return {
          framework: 'make',
          devCommand: 'make dev',
          devPort: 3000,
          packageManager: 'npm',
          source: 'non-node',
          suggestions: ['make dev', 'make run', 'make start'],
        }
      }
    } catch {}
  }

  return null
}

// ── IPC handler ─────────────────────────────────────────────────────
export function setupFrameworkDetectHandlers(): void {
  ipcMain.handle('framework:detect', (_event, projectPath: string) => {
    return detectFramework(projectPath)
  })
}
