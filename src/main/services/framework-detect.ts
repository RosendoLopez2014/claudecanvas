import { ipcMain } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface FrameworkInfo {
  framework: string
  devCommand: string
  devPort: number
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const FRAMEWORK_PATTERNS: Array<{
  id: string
  packages: string[]
  devCommand: string
  devPort: number
}> = [
  { id: 'nextjs', packages: ['next'], devCommand: 'npm run dev', devPort: 3000 },
  { id: 'nuxt', packages: ['nuxt'], devCommand: 'npm run dev', devPort: 3000 },
  { id: 'remix', packages: ['@remix-run/react'], devCommand: 'npm run dev', devPort: 5173 },
  { id: 'astro', packages: ['astro'], devCommand: 'npm run dev', devPort: 4321 },
  { id: 'sveltekit', packages: ['@sveltejs/kit'], devCommand: 'npm run dev', devPort: 5173 },
  { id: 'vite', packages: ['vite'], devCommand: 'npm run dev', devPort: 5173 },
  { id: 'gatsby', packages: ['gatsby'], devCommand: 'npm run develop', devPort: 8000 },
  { id: 'cra', packages: ['react-scripts'], devCommand: 'npm start', devPort: 3000 },
  { id: 'angular', packages: ['@angular/core'], devCommand: 'npm start', devPort: 4200 },
  { id: 'vue', packages: ['vue'], devCommand: 'npm run dev', devPort: 5173 },
]

export function detectFramework(projectPath: string): FrameworkInfo | null {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return null

  try {
    const raw = readFileSync(pkgPath, 'utf-8')
    const pkg: PackageJson = JSON.parse(raw)
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

    for (const pattern of FRAMEWORK_PATTERNS) {
      if (pattern.packages.some((p) => p in allDeps)) {
        // Check if scripts has a dev command to override the default
        let devCommand = pattern.devCommand
        if (pkg.scripts) {
          if ('dev' in pkg.scripts) devCommand = 'npm run dev'
          else if ('start' in pkg.scripts) devCommand = 'npm start'
          else if ('develop' in pkg.scripts) devCommand = 'npm run develop'
        }
        return { framework: pattern.id, devCommand, devPort: pattern.devPort }
      }
    }

    // Generic Node project with scripts
    if (pkg.scripts) {
      if ('dev' in pkg.scripts) return { framework: 'node', devCommand: 'npm run dev', devPort: 3000 }
      if ('start' in pkg.scripts) return { framework: 'node', devCommand: 'npm start', devPort: 3000 }
    }
  } catch {
    // Invalid JSON or read error
  }

  return null
}

export function setupFrameworkDetectHandlers(): void {
  ipcMain.handle('framework:detect', (_event, projectPath: string) => {
    return detectFramework(projectPath)
  })
}
