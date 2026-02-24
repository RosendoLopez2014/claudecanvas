/**
 * Project Profile Generator — builds a structured profile of any opened project.
 *
 * Four sub-scanners produce a ProjectProfile that is rendered as markdown
 * and injected into CLAUDE.md so the LLM has full project awareness.
 *
 * All filesystem access is synchronous (runs at project-open time in main process).
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, basename, extname, dirname } from 'path'
import { resolveDevServerPlan } from '../devserver/resolve'
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
  framework: string | null
  frameworkVersion: string | null
  packageManager: string
  devPort: number
  language: 'typescript' | 'javascript'
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
  source: 'tailwind-config' | 'css-variables'
  colors: Record<string, string>
  fonts: Record<string, string>
  borderRadius: string | null
  spacing: string | null
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

function scanFrameworkAndStructure(projectPath: string): {
  framework: string | null
  frameworkVersion: string | null
  packageManager: string
  devPort: number
  language: 'typescript' | 'javascript'
  keyDirectories: string[]
} {
  // Resolve framework, PM, and port via devserver resolver
  const plan = resolveDevServerPlan(projectPath)
  const framework = plan.detection.framework ?? null
  const packageManager = plan.manager
  const devPort = plan.port ?? 3000

  // Determine framework version from package.json
  let frameworkVersion: string | null = null
  if (framework && FRAMEWORK_PACKAGES[framework]) {
    try {
      const raw = readFileSync(join(projectPath, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw)
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const depName = FRAMEWORK_PACKAGES[framework]
      if (allDeps[depName]) {
        frameworkVersion = allDeps[depName]?.replace(/^[\^~>=<]+/, '') || null
      }
    } catch {
      // Can't read package.json — leave version null
    }
  }

  // Detect TypeScript
  let language: 'typescript' | 'javascript' = 'javascript'
  if (existsSync(join(projectPath, 'tsconfig.json'))) {
    language = 'typescript'
  }

  // Scan for key directories
  const KEY_DIR_NAMES = [
    'app', 'pages', 'components', 'lib', 'utils', 'hooks',
    'styles', 'api', 'server', 'public', 'assets', 'layouts',
    'features', 'modules', 'services', 'stores',
  ]

  const keyDirectories: string[] = []

  // Check under src/ and root (inclusive — both are scanned)
  const searchRoots: Array<{ root: string; prefix: string }> = []
  if (existsSync(join(projectPath, 'src'))) {
    searchRoots.push({ root: join(projectPath, 'src'), prefix: 'src/' })
  }
  searchRoots.push({ root: projectPath, prefix: '' })

  for (const { root, prefix } of searchRoots) {
    try {
      const entries = readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && KEY_DIR_NAMES.includes(entry.name)) {
          const dirLabel = prefix + entry.name
          if (!keyDirectories.includes(dirLabel)) {
            keyDirectories.push(dirLabel)
          }
        }
      }
    } catch { /* ignore */ }
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

function scanComponentInventory(
  projectPath: string,
  framework: string | null
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
  const colors: Record<string, string> = {}
  const fonts: Record<string, string> = {}
  let borderRadius: string | null = null
  let spacing: string | null = null

  // Extract from theme.extend block
  // Match colors object inside extend
  const colorsMatch = content.match(/colors\s*:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s)
  if (colorsMatch) {
    const colorPairs = colorsMatch[1].matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)
    for (const m of colorPairs) {
      colors[m[1]] = m[2]
    }
  }

  // Extract fontFamily
  const fontMatch = content.match(/fontFamily\s*:\s*\{([^}]*)\}/s)
  if (fontMatch) {
    const fontPairs = fontMatch[1].matchAll(/(\w+)\s*:\s*\[['"]([^'"]+)['"]/g)
    for (const m of fontPairs) {
      fonts[m[1]] = m[2]
    }
  }

  // Extract borderRadius (single string match)
  const radiusMatch = content.match(/borderRadius\s*:\s*\{[^}]*\w+\s*:\s*['"]([^'"]+)['"]/s)
  if (radiusMatch) {
    borderRadius = radiusMatch[1]
  }

  // Extract spacing (single string match)
  const spacingMatch = content.match(/spacing\s*:\s*\{[^}]*\w+\s*:\s*['"]([^'"]+)['"]/s)
  if (spacingMatch) {
    spacing = spacingMatch[1]
  }

  if (Object.keys(colors).length === 0 && Object.keys(fonts).length === 0 && borderRadius === null && spacing === null) {
    return null
  }

  return { source: 'tailwind-config', colors, fonts, borderRadius, spacing }
}

function extractCssVariableTokens(content: string): DesignTokens | null {
  const colors: Record<string, string> = {}
  const fonts: Record<string, string> = {}
  let borderRadius: string | null = null
  let spacing: string | null = null

  // Extract --color-* custom properties (only color-like values)
  const colorVars = content.matchAll(/--(?:color-)?(\w[\w-]*?):\s*([^;}\n]+)/g)
  for (const match of colorVars) {
    const value = match[2].trim()
    // Only include if value looks like a color
    if (/^(#|rgb|hsl|oklch|color\(|var\(|\d)/.test(value)) {
      colors[match[1]] = value
    }
  }

  // Extract --font-* custom properties
  const fontVars = content.matchAll(/--font-(\w[\w-]*):\s*([^;}\n]+)/g)
  for (const match of fontVars) {
    fonts[match[1]] = match[2].trim()
  }

  // Extract --radius custom property (single string)
  const radiusMatch = content.match(/--radius\s*:\s*([^;}\n]+)/)
  if (radiusMatch) {
    borderRadius = radiusMatch[1].trim()
  }

  // Extract --spacing custom property (single string)
  const spacingMatch = content.match(/--spacing\s*:\s*([^;}\n]+)/)
  if (spacingMatch) {
    spacing = spacingMatch[1].trim()
  }

  if (Object.keys(colors).length === 0 && Object.keys(fonts).length === 0 && borderRadius === null && spacing === null) {
    return null
  }

  return { source: 'css-variables', colors, fonts, borderRadius, spacing }
}

function readDesignTokens(projectPath: string): DesignTokens | null {
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

const DEP_CATEGORIES: Array<{
  category: keyof DependencySummary
  patterns: Array<{ match: string | RegExp; label: string }>
}> = [
  {
    category: 'ui',
    patterns: [
      { match: /^@radix-ui\//, label: 'Radix UI' },
      { match: /^@shadcn\//, label: 'shadcn/ui' },
      { match: /^@mui\//, label: 'MUI' },
      { match: /^@chakra-ui\//, label: 'Chakra UI' },
      { match: /^@headlessui\//, label: 'Headless UI' },
      { match: /^@mantine\//, label: 'Mantine' },
      { match: 'antd', label: 'Ant Design' },
      { match: 'framer-motion', label: 'Framer Motion' },
    ],
  },
  {
    category: 'auth',
    patterns: [
      { match: 'next-auth', label: 'NextAuth.js' },
      { match: /^@clerk\//, label: 'Clerk' },
      { match: '@supabase/auth-helpers', label: 'Supabase Auth' },
      { match: /^@auth\//, label: 'Auth.js' },
      { match: 'passport', label: 'Passport.js' },
      { match: 'lucia', label: 'Lucia' },
    ],
  },
  {
    category: 'database',
    patterns: [
      { match: '@supabase/supabase-js', label: 'Supabase' },
      { match: 'prisma', label: 'Prisma' },
      { match: '@prisma/client', label: 'Prisma' },
      { match: 'drizzle-orm', label: 'Drizzle' },
      { match: 'mongoose', label: 'Mongoose' },
      { match: 'typeorm', label: 'TypeORM' },
      { match: /^@planetscale\//, label: 'PlanetScale' },
      { match: 'firebase', label: 'Firebase' },
      { match: /^@firebase\//, label: 'Firebase' },
    ],
  },
  {
    category: 'state',
    patterns: [
      { match: 'zustand', label: 'Zustand' },
      { match: '@reduxjs/toolkit', label: 'Redux Toolkit' },
      { match: 'jotai', label: 'Jotai' },
      { match: 'recoil', label: 'Recoil' },
      { match: 'valtio', label: 'Valtio' },
      { match: 'mobx', label: 'MobX' },
      { match: '@tanstack/react-query', label: 'TanStack Query' },
    ],
  },
  {
    category: 'testing',
    patterns: [
      { match: 'vitest', label: 'Vitest' },
      { match: 'jest', label: 'Jest' },
      { match: /^@testing-library\//, label: 'Testing Library' },
      { match: 'playwright', label: 'Playwright' },
      { match: /^@playwright\//, label: 'Playwright' },
      { match: 'cypress', label: 'Cypress' },
    ],
  },
]

function summarizeDependencies(projectPath: string): DependencySummary {
  const result: DependencySummary = { ui: [], auth: [], database: [], state: [], testing: [] }
  try {
    const pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'))
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const { category, patterns } of DEP_CATEGORIES) {
      const seen = new Set<string>()
      for (const { match, label } of patterns) {
        if (seen.has(label)) continue
        const found = typeof match === 'string'
          ? allDeps.some((d) => d === match || d.startsWith(match))
          : allDeps.some((d) => (match as RegExp).test(d))
        if (found) {
          seen.add(label)
          result[category].push(label)
        }
      }
    }
  } catch { /* no package.json */ }
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
  lines.push(`- **Dev Port:** ${profile.devPort}`)
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

    const colorEntries = Object.entries(ds.colors)
    if (colorEntries.length > 0) {
      const displayColors = colorEntries.slice(0, 8)
      const moreCount = colorEntries.length - displayColors.length
      const suffix = moreCount > 0 ? `, +${moreCount} more` : ''
      lines.push(`- **Colors:** ${displayColors.map(([k, v]) => `${k}: ${v}`).join(', ')}${suffix}`)
    }

    const fontEntries = Object.entries(ds.fonts)
    if (fontEntries.length > 0) {
      const displayFonts = fontEntries.slice(0, 4)
      const moreCount = fontEntries.length - displayFonts.length
      const suffix = moreCount > 0 ? `, +${moreCount} more` : ''
      lines.push(`- **Fonts:** ${displayFonts.map(([k, v]) => `${k}: ${v}`).join(', ')}${suffix}`)
    }

    if (ds.borderRadius !== null) {
      lines.push(`- **Border Radius:** ${ds.borderRadius}`)
    }

    if (ds.spacing !== null) {
      lines.push(`- **Spacing:** ${ds.spacing}`)
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
