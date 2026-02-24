/**
 * Project Profile Generator — builds a structured profile of any opened project.
 *
 * Four sub-scanners produce a ProjectProfile that is rendered as markdown
 * and injected into CLAUDE.md so the LLM has full project awareness.
 *
 * All filesystem access is synchronous (runs at project-open time in main process).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, basename, extname, dirname } from 'path'
import { resolveDevServerPlan } from '../devserver/resolve'
import { commandToString } from '../../shared/devserver/types'
import {
  IGNORE_DIRS,
  IGNORE_PATTERNS,
  COMPONENT_EXTENSIONS,
  MAX_DEPTH,
  parseComponentName,
  fileNameToComponentName,
} from './component-scanner'

// ── Types ────────────────────────────────────────────────────────

export interface ProjectProfile {
  framework: string | undefined
  frameworkVersion: string | undefined
  packageManager: string
  devPort: number | undefined
  language: 'TypeScript' | 'JavaScript'
  keyDirectories: string[]
  components: ComponentGroup[]
  designSystem: DesignTokens | null
  dependencies: DependencySummary
}

export interface ComponentGroup {
  group: string
  items: string[]
  overflow: number
}

export interface DesignTokens {
  source: string
  colors: string[]
  fonts: string[]
  borderRadius: string[]
  spacing: string[]
}

export interface DependencySummary {
  ui: string[]
  auth: string[]
  database: string[]
  state: string[]
  testing: string[]
}

// ── Framework package lookup ─────────────────────────────────────

const FRAMEWORK_PACKAGES: Record<string, string> = {
  nextjs: 'next',
  nuxt: 'nuxt',
  remix: '@remix-run/react',
  astro: 'astro',
  sveltekit: '@sveltejs/kit',
  vite: 'vite',
  gatsby: 'gatsby',
  cra: 'react-scripts',
  angular: '@angular/core',
  vue: 'vue',
  express: 'express',
  nestjs: '@nestjs/core',
}

// ── Sub-scanner 1: Framework & Structure ─────────────────────────

export function scanFrameworkAndStructure(projectPath: string): {
  framework: string | undefined
  frameworkVersion: string | undefined
  packageManager: string
  devPort: number | undefined
  language: 'TypeScript' | 'JavaScript'
  keyDirectories: string[]
} {
  // Resolve framework, PM, and port via devserver resolver
  const plan = resolveDevServerPlan(projectPath)
  const framework = plan.detection.framework
  const packageManager = plan.manager
  const devPort = plan.port

  // Determine framework version from package.json
  let frameworkVersion: string | undefined
  if (framework && FRAMEWORK_PACKAGES[framework]) {
    try {
      const raw = readFileSync(join(projectPath, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw)
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const depName = FRAMEWORK_PACKAGES[framework]
      if (allDeps[depName]) {
        frameworkVersion = allDeps[depName]
      }
    } catch {
      // Can't read package.json — leave version undefined
    }
  }

  // Detect TypeScript
  let language: 'TypeScript' | 'JavaScript' = 'JavaScript'
  if (existsSync(join(projectPath, 'tsconfig.json'))) {
    language = 'TypeScript'
  }

  // Scan for key directories
  const KEY_DIR_NAMES = [
    'app', 'pages', 'components', 'lib', 'utils', 'hooks',
    'styles', 'api', 'server', 'public', 'assets', 'layouts',
    'features', 'modules', 'services', 'stores',
  ]

  const keyDirectories: string[] = []

  // Check under src/ first, then root
  const searchRoots = existsSync(join(projectPath, 'src'))
    ? [join(projectPath, 'src')]
    : [projectPath]

  for (const root of searchRoots) {
    try {
      const entries = readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && KEY_DIR_NAMES.includes(entry.name)) {
          const prefix = root === projectPath ? '' : 'src/'
          const dirLabel = `${prefix}${entry.name}/`
          if (!keyDirectories.includes(dirLabel)) {
            keyDirectories.push(dirLabel)
          }
        }
      }
    } catch {
      // Can't read directory — skip
    }
  }

  // Sort alphabetically for consistency
  keyDirectories.sort()

  return { framework, frameworkVersion, packageManager, devPort, language, keyDirectories }
}

// ── Sub-scanner 2: Component Inventory ───────────────────────────

function scanComponentDir(
  dirPath: string,
  depth: number,
  groups: Map<string, string[]>,
  totalCount: { value: number },
  overflowMap: Map<string, number>
): void {
  if (depth > MAX_DEPTH || totalCount.value >= 50) return

  let entries
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (totalCount.value >= 50) break

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      scanComponentDir(fullPath, depth + 1, groups, totalCount, overflowMap)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (!COMPONENT_EXTENSIONS.has(ext)) continue
      if (IGNORE_PATTERNS.some((p) => entry.name.includes(p))) continue
      if (entry.name === 'index.tsx' || entry.name === 'index.jsx') continue

      // Determine group name from parent directory (PascalCase)
      const parentDir = basename(dirname(fullPath))
      const groupName = parentDir
        .split(/[-_.]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')

      // Extract component name
      let name: string
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const parsedName = parseComponentName(content)
        name = parsedName || fileNameToComponentName(entry.name)
      } catch {
        name = fileNameToComponentName(entry.name)
      }

      if (totalCount.value < 50) {
        const items = groups.get(groupName) || []
        items.push(name)
        groups.set(groupName, items)
        totalCount.value++
      } else {
        // Track overflow per group
        overflowMap.set(groupName, (overflowMap.get(groupName) || 0) + 1)
      }
    }
  }
}

export function scanComponentInventory(
  projectPath: string,
  framework: string | undefined
): ComponentGroup[] {
  const groups = new Map<string, string[]>()
  const totalCount = { value: 0 }
  const overflowMap = new Map<string, number>()

  // Always scan src/components/
  const componentsDir = join(projectPath, 'src', 'components')
  if (existsSync(componentsDir)) {
    scanComponentDir(componentsDir, 0, groups, totalCount, overflowMap)
  }

  // Also scan src/app/ for Next.js page components
  if (framework === 'nextjs') {
    const appDir = join(projectPath, 'src', 'app')
    if (existsSync(appDir)) {
      scanComponentDir(appDir, 0, groups, totalCount, overflowMap)
    }
  }

  // Build result
  const result: ComponentGroup[] = []
  for (const [group, items] of groups) {
    result.push({
      group,
      items,
      overflow: overflowMap.get(group) || 0,
    })
  }

  // Sort groups alphabetically
  result.sort((a, b) => a.group.localeCompare(b.group))

  return result
}

// ── Sub-scanner 3: Design Tokens ─────────────────────────────────

function extractTailwindTokens(content: string): DesignTokens | null {
  const colors: string[] = []
  const fonts: string[] = []
  const borderRadius: string[] = []
  const spacing: string[] = []

  // Extract from theme.extend block
  // Match colors object inside extend
  const colorsMatch = content.match(/colors\s*:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s)
  if (colorsMatch) {
    // Extract color names (keys of the object)
    const colorKeys = colorsMatch[1].match(/['"]?([\w-]+)['"]?\s*:/g)
    if (colorKeys) {
      for (const key of colorKeys) {
        const name = key.replace(/['":\s]/g, '')
        if (name && !colors.includes(name)) colors.push(name)
      }
    }
  }

  // Extract fontFamily
  const fontMatch = content.match(/fontFamily\s*:\s*\{([^}]*)\}/s)
  if (fontMatch) {
    const fontKeys = fontMatch[1].match(/['"]?([\w-]+)['"]?\s*:/g)
    if (fontKeys) {
      for (const key of fontKeys) {
        const name = key.replace(/['":\s]/g, '')
        if (name && !fonts.includes(name)) fonts.push(name)
      }
    }
  }

  // Extract borderRadius
  const radiusMatch = content.match(/borderRadius\s*:\s*\{([^}]*)\}/s)
  if (radiusMatch) {
    const radiusKeys = radiusMatch[1].match(/['"]?([\w-]+)['"]?\s*:\s*['"]?([^'",\n}]+)['"]?/g)
    if (radiusKeys) {
      for (const pair of radiusKeys) {
        const m = pair.match(/['"]?([\w-]+)['"]?\s*:\s*['"]?([^'",\n}]+)['"]?/)
        if (m) borderRadius.push(`${m[1]}: ${m[2].trim()}`)
      }
    }
  }

  // Extract spacing
  const spacingMatch = content.match(/spacing\s*:\s*\{([^}]*)\}/s)
  if (spacingMatch) {
    const spacingKeys = spacingMatch[1].match(/['"]?([\w-]+)['"]?\s*:\s*['"]?([^'",\n}]+)['"]?/g)
    if (spacingKeys) {
      for (const pair of spacingKeys) {
        const m = pair.match(/['"]?([\w-]+)['"]?\s*:\s*['"]?([^'",\n}]+)['"]?/)
        if (m) spacing.push(`${m[1]}: ${m[2].trim()}`)
      }
    }
  }

  if (colors.length === 0 && fonts.length === 0 && borderRadius.length === 0 && spacing.length === 0) {
    return null
  }

  return { source: 'Tailwind config', colors, fonts, borderRadius, spacing }
}

function extractCssVariableTokens(content: string): DesignTokens | null {
  const colors: string[] = []
  const fonts: string[] = []
  const borderRadius: string[] = []
  const spacing: string[] = []

  // Extract --color-* custom properties
  const colorVars = content.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)
  for (const match of colorVars) {
    colors.push(`${match[1]}: ${match[2].trim()}`)
  }

  // Extract --font-* custom properties
  const fontVars = content.matchAll(/--font-([\w-]+)\s*:\s*([^;]+);/g)
  for (const match of fontVars) {
    fonts.push(`${match[1]}: ${match[2].trim()}`)
  }

  // Extract --radius custom properties
  const radiusVars = content.matchAll(/--radius(?:-([\w-]+))?\s*:\s*([^;]+);/g)
  for (const match of radiusVars) {
    const name = match[1] ? match[1] : 'default'
    borderRadius.push(`${name}: ${match[2].trim()}`)
  }

  // Extract --spacing custom properties
  const spacingVars = content.matchAll(/--spacing(?:-([\w-]+))?\s*:\s*([^;]+);/g)
  for (const match of spacingVars) {
    const name = match[1] ? match[1] : 'default'
    spacing.push(`${name}: ${match[2].trim()}`)
  }

  if (colors.length === 0 && fonts.length === 0 && borderRadius.length === 0 && spacing.length === 0) {
    return null
  }

  return { source: 'CSS variables', colors, fonts, borderRadius, spacing }
}

export function readDesignTokens(projectPath: string): DesignTokens | null {
  // Priority 1: Tailwind config
  const tailwindFiles = [
    'tailwind.config.ts',
    'tailwind.config.js',
    'tailwind.config.mjs',
  ]

  for (const filename of tailwindFiles) {
    const filepath = join(projectPath, filename)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf-8')
        const tokens = extractTailwindTokens(content)
        if (tokens) return tokens
      } catch {
        // Can't read — try next
      }
    }
  }

  // Priority 2: CSS files with custom properties
  const cssFiles = [
    'src/app/globals.css',
    'src/styles/globals.css',
    'app/globals.css',
    'styles/globals.css',
    'src/index.css',
    'src/global.css',
  ]

  for (const relPath of cssFiles) {
    const filepath = join(projectPath, relPath)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf-8')
        const tokens = extractCssVariableTokens(content)
        if (tokens) return tokens
      } catch {
        // Can't read — try next
      }
    }
  }

  return null
}

// ── Sub-scanner 4: Dependencies ──────────────────────────────────

const DEP_CATEGORIES: Record<keyof DependencySummary, Array<string | RegExp>> = {
  ui: [
    /^@radix-ui\//,
    /^@shadcn\//,
    /^@mui\//,
    /^@chakra-ui\//,
    /^@headlessui\//,
    /^@mantine\//,
    'antd',
    'framer-motion',
  ],
  auth: [
    'next-auth',
    /^@clerk\//,
    '@supabase/auth-helpers',
    /^@auth\//,
    'passport',
    'lucia',
  ],
  database: [
    '@supabase/supabase-js',
    'prisma',
    '@prisma/client',
    'drizzle-orm',
    'mongoose',
    'typeorm',
    /^@planetscale\//,
    'firebase',
    /^@firebase\//,
  ],
  state: [
    'zustand',
    '@reduxjs/toolkit',
    'jotai',
    'recoil',
    'valtio',
    'mobx',
    '@tanstack/react-query',
  ],
  testing: [
    'vitest',
    'jest',
    /^@testing-library\//,
    'playwright',
    /^@playwright\//,
    'cypress',
  ],
}

function matchesDep(depName: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') return depName === pattern
  return pattern.test(depName)
}

export function summarizeDependencies(projectPath: string): DependencySummary {
  const result: DependencySummary = {
    ui: [],
    auth: [],
    database: [],
    state: [],
    testing: [],
  }

  try {
    const raw = readFileSync(join(projectPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })

    for (const depName of allDeps) {
      for (const category of Object.keys(DEP_CATEGORIES) as Array<keyof DependencySummary>) {
        for (const pattern of DEP_CATEGORIES[category]) {
          if (matchesDep(depName, pattern)) {
            if (!result[category].includes(depName)) {
              result[category].push(depName)
            }
            break
          }
        }
      }
    }
  } catch {
    // Can't read package.json — return empty
  }

  return result
}

// ── Main Export ──────────────────────────────────────────────────

export function generateProjectProfile(projectPath: string): ProjectProfile {
  const structure = scanFrameworkAndStructure(projectPath)
  const components = scanComponentInventory(projectPath, structure.framework)
  const designSystem = readDesignTokens(projectPath)
  const dependencies = summarizeDependencies(projectPath)

  return {
    framework: structure.framework,
    frameworkVersion: structure.frameworkVersion,
    packageManager: structure.packageManager,
    devPort: structure.devPort,
    language: structure.language,
    keyDirectories: structure.keyDirectories,
    components,
    designSystem,
    dependencies,
  }
}

// ── Markdown Renderer ────────────────────────────────────────────

export function renderProjectProfile(profile: ProjectProfile): string {
  const lines: string[] = []

  // Header
  lines.push('## Project Profile (auto-detected)')
  lines.push('')

  // Framework & basics
  const frameworkLabel = profile.framework
    ? `${profile.framework}${profile.frameworkVersion ? ` ${profile.frameworkVersion}` : ''}`
    : 'Unknown'
  lines.push(`- **Framework:** ${frameworkLabel}`)
  lines.push(`- **Package Manager:** ${profile.packageManager}`)
  if (profile.devPort) {
    lines.push(`- **Dev Port:** ${profile.devPort}`)
  }
  lines.push(`- **Language:** ${profile.language}`)
  lines.push('')

  // Key Directories
  if (profile.keyDirectories.length > 0) {
    lines.push('### Key Directories')
    lines.push('')
    for (const dir of profile.keyDirectories) {
      lines.push(`- \`${dir}\``)
    }
    lines.push('')
  }

  // Components
  const totalComponents = profile.components.reduce(
    (sum, g) => sum + g.items.length + g.overflow, 0
  )
  if (totalComponents > 0) {
    lines.push(`### Components (${totalComponents} found)`)
    lines.push('')
    for (const group of profile.components) {
      const overflowLabel = group.overflow > 0 ? ` (+${group.overflow} more)` : ''
      lines.push(`**${group.group}:** ${group.items.join(', ')}${overflowLabel}`)
    }
    lines.push('')
  }

  // Design System
  if (profile.designSystem) {
    const ds = profile.designSystem
    lines.push(`### Design System (from ${ds.source})`)
    lines.push('')

    if (ds.colors.length > 0) {
      const displayColors = ds.colors.slice(0, 8)
      const moreCount = ds.colors.length - displayColors.length
      const suffix = moreCount > 0 ? `, +${moreCount} more` : ''
      lines.push(`- **Colors:** ${displayColors.join(', ')}${suffix}`)
    }

    if (ds.fonts.length > 0) {
      const displayFonts = ds.fonts.slice(0, 4)
      const moreCount = ds.fonts.length - displayFonts.length
      const suffix = moreCount > 0 ? `, +${moreCount} more` : ''
      lines.push(`- **Fonts:** ${displayFonts.join(', ')}${suffix}`)
    }

    if (ds.borderRadius.length > 0) {
      lines.push(`- **Border Radius:** ${ds.borderRadius.join(', ')}`)
    }

    if (ds.spacing.length > 0) {
      lines.push(`- **Spacing:** ${ds.spacing.join(', ')}`)
    }

    lines.push('')
  }

  // Dependencies
  const deps = profile.dependencies
  const hasAnyDeps = deps.ui.length > 0 || deps.auth.length > 0 ||
    deps.database.length > 0 || deps.state.length > 0 || deps.testing.length > 0

  if (hasAnyDeps) {
    lines.push('### Key Dependencies')
    lines.push('')
    if (deps.ui.length > 0) lines.push(`- **UI:** ${deps.ui.join(', ')}`)
    if (deps.auth.length > 0) lines.push(`- **Auth:** ${deps.auth.join(', ')}`)
    if (deps.database.length > 0) lines.push(`- **Database:** ${deps.database.join(', ')}`)
    if (deps.state.length > 0) lines.push(`- **State:** ${deps.state.join(', ')}`)
    if (deps.testing.length > 0) lines.push(`- **Testing:** ${deps.testing.join(', ')}`)
    lines.push('')
  }

  return lines.join('\n')
}
