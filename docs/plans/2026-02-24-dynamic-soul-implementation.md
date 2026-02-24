# Dynamic Project Soul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Claude full project awareness from the first message by generating a dynamic CLAUDE.md with project profile, user soul file, and richer MCP tool responses.

**Architecture:** Single-file pipeline — `generateProjectProfile()` runs four synchronous sub-scanners at project-open time, returns a `ProjectProfile` object. `writeCanvasClaudeMd()` templates it + soul.md + static instructions into the CLAUDE.md.

**Tech Stack:** Node.js filesystem APIs (sync reads), TypeScript, existing `resolveDevServerPlan()` and component scanner.

**Design Doc:** `docs/plans/2026-02-24-dynamic-soul-design.md`

---

### Task 1: Create the ProjectProfile types and framework/structure scanner

**Files:**
- Create: `src/main/services/project-profile.ts`

**Step 1: Create the file with types and the framework+structure sub-scanner**

```ts
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, basename, dirname } from 'path'
import { resolveDevServerPlan } from '../devserver/resolve'
import { commandToString } from '../../shared/devserver/types'

// ── Types ───────────────────────────────────────────────────────────

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

// ── Package.json shape ──────────────────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

// ── Key directory names to look for ─────────────────────────────────

const KEY_DIR_NAMES = [
  'app', 'pages', 'components', 'lib', 'utils', 'hooks',
  'styles', 'api', 'server', 'public', 'assets', 'layouts',
  'features', 'modules', 'services', 'stores',
]

// ── Framework version lookup ────────────────────────────────────────

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

// ── Sub-scanner 1: Framework + Structure ────────────────────────────

function scanFrameworkAndStructure(projectPath: string): {
  framework: string | null
  frameworkVersion: string | null
  packageManager: string
  devPort: number
  language: 'typescript' | 'javascript'
  keyDirectories: string[]
} {
  const plan = resolveDevServerPlan(projectPath)
  const framework = plan.detection.framework || null
  const packageManager = plan.manager
  const devPort = plan.port ?? 3000

  // Framework version from package.json
  let frameworkVersion: string | null = null
  if (framework && FRAMEWORK_PACKAGES[framework]) {
    try {
      const pkg: PackageJson = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'))
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const depName = FRAMEWORK_PACKAGES[framework]
      frameworkVersion = allDeps[depName]?.replace(/^[\^~>=<]/, '') || null
    } catch { /* ignore */ }
  }

  // TypeScript detection
  const language = existsSync(join(projectPath, 'tsconfig.json')) ? 'typescript' as const : 'javascript' as const

  // Key directories — check src/ first, then project root
  const keyDirectories: string[] = []
  const srcDir = join(projectPath, 'src')
  const scanRoot = existsSync(srcDir) ? srcDir : projectPath
  const prefix = existsSync(srcDir) ? 'src/' : ''

  try {
    const entries = readdirSync(scanRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && KEY_DIR_NAMES.includes(entry.name)) {
        keyDirectories.push(prefix + entry.name)
      }
    }
  } catch { /* ignore */ }

  return { framework, frameworkVersion, packageManager, devPort, language, keyDirectories }
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/main/services/project-profile.ts 2>&1 | head -20`
Expected: No errors (or only errors about missing later parts we haven't written yet)

**Step 3: Commit**

```bash
git add src/main/services/project-profile.ts
git commit -m "feat(soul): add project-profile types and framework scanner"
```

---

### Task 2: Add component inventory scanner to project-profile

**Files:**
- Modify: `src/main/services/component-scanner.ts` (export shared constants)
- Modify: `src/main/services/project-profile.ts` (add sub-scanner 2)

**Step 1: Export shared constants from component-scanner.ts**

Add `export` keyword to `IGNORE_DIRS`, `IGNORE_PATTERNS`, `COMPONENT_EXTENSIONS`, `MAX_DEPTH`, and `parseComponentName` at the top of `src/main/services/component-scanner.ts`:

```ts
// Change these from private to exported:
export const IGNORE_DIRS = new Set([...])
export const IGNORE_PATTERNS = ['.test.', '.spec.', '.stories.']
export const COMPONENT_EXTENSIONS = new Set(['.tsx', '.jsx'])
export const MAX_DEPTH = 5

// Also export parseComponentName:
export function parseComponentName(content: string): string | null {
```

**Step 2: Add sub-scanner 2 to project-profile.ts**

Append after `scanFrameworkAndStructure`:

```ts
import { readFileSync, existsSync, readdirSync, Dirent } from 'fs'
import { join, basename, dirname, extname, relative } from 'path'
import {
  IGNORE_DIRS, IGNORE_PATTERNS, COMPONENT_EXTENSIONS,
  MAX_DEPTH, fileNameToComponentName
} from './component-scanner'

// (add parseComponentName import too — it's now exported)
import { parseComponentName } from './component-scanner'

// ── Sub-scanner 2: Component Inventory ──────────────────────────────

const MAX_COMPONENT_NAMES = 50

function scanComponentsSync(
  dirPath: string,
  projectPath: string,
  results: Array<{ name: string; group: string }>,
  depth: number
): void {
  if (depth > MAX_DEPTH) return

  let entries: Dirent[]
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  // The "group" is the immediate parent directory name, PascalCased
  const group = basename(dirPath)
    .split(/[-_.]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      scanComponentsSync(fullPath, projectPath, results, depth + 1)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (!COMPONENT_EXTENSIONS.has(ext)) continue
      if (IGNORE_PATTERNS.some((p) => entry.name.includes(p))) continue
      if (entry.name === 'index.tsx' || entry.name === 'index.jsx') continue

      let name: string
      try {
        const content = readFileSync(fullPath, 'utf-8')
        name = parseComponentName(content) || fileNameToComponentName(entry.name)
      } catch {
        name = fileNameToComponentName(entry.name)
      }

      results.push({ name, group })
    }
  }
}

function scanComponentInventory(projectPath: string, framework: string | null): ComponentGroup[] {
  const raw: Array<{ name: string; group: string }> = []

  // Always scan src/components/
  const componentsDir = join(projectPath, 'src', 'components')
  if (existsSync(componentsDir)) {
    scanComponentsSync(componentsDir, projectPath, raw, 0)
  }

  // For Next.js, also scan src/app/ for page components
  if (framework === 'nextjs') {
    const appDir = join(projectPath, 'src', 'app')
    if (existsSync(appDir)) {
      scanComponentsSync(appDir, projectPath, raw, 0)
    }
  }

  // Group by parent directory
  const grouped = new Map<string, string[]>()
  for (const { name, group } of raw) {
    const list = grouped.get(group) || []
    list.push(name)
    grouped.set(group, list)
  }

  // Cap at MAX_COMPONENT_NAMES total
  let total = 0
  const result: ComponentGroup[] = []
  for (const [group, items] of grouped) {
    const remaining = MAX_COMPONENT_NAMES - total
    if (remaining <= 0) break
    const shown = items.slice(0, remaining)
    result.push({
      group,
      items: shown,
      overflow: Math.max(0, items.length - shown.length),
    })
    total += shown.length
  }

  return result
}
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add src/main/services/component-scanner.ts src/main/services/project-profile.ts
git commit -m "feat(soul): add component inventory scanner"
```

---

### Task 3: Add design system reader to project-profile

**Files:**
- Modify: `src/main/services/project-profile.ts` (add sub-scanner 3)

**Step 1: Add the design tokens reader**

Append after `scanComponentInventory`:

```ts
// ── Sub-scanner 3: Design System Reader ─────────────────────────────

/** Glob-free file finder — checks known locations for CSS/config files */
function findFile(projectPath: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const fullPath = join(projectPath, candidate)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

function readDesignTokens(projectPath: string): DesignTokens | null {
  // Priority 1: Tailwind config
  const twConfig = findFile(projectPath, [
    'tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs',
  ])

  if (twConfig) {
    try {
      const content = readFileSync(twConfig, 'utf-8')
      const tokens = parseTailwindConfig(content)
      if (tokens && (Object.keys(tokens.colors).length > 0 || Object.keys(tokens.fonts).length > 0)) {
        return { source: 'tailwind-config', ...tokens }
      }
    } catch { /* ignore */ }
  }

  // Priority 2: CSS-in-Tailwind v4 (@theme block in globals.css)
  // Priority 3: CSS custom properties
  const cssFile = findFile(projectPath, [
    'src/app/globals.css', 'src/styles/globals.css', 'src/globals.css',
    'app/globals.css', 'styles/globals.css',
    'src/app.css', 'src/index.css', 'src/styles/variables.css',
  ])

  if (cssFile) {
    try {
      const content = readFileSync(cssFile, 'utf-8')
      const tokens = parseCssVariables(content)
      if (tokens && (Object.keys(tokens.colors).length > 0 || Object.keys(tokens.fonts).length > 0)) {
        return { source: 'css-variables', ...tokens }
      }
    } catch { /* ignore */ }
  }

  return null
}

function parseTailwindConfig(content: string): Omit<DesignTokens, 'source'> | null {
  const colors: Record<string, string> = {}
  const fonts: Record<string, string> = {}
  let borderRadius: string | null = null
  let spacing: string | null = null

  // Extract color definitions: primary: '#3B82F6' or primary: { DEFAULT: '#3B82F6' }
  const colorBlock = content.match(/colors\s*:\s*\{([\s\S]*?)\}/)?.[1]
  if (colorBlock) {
    const colorPairs = colorBlock.matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)
    for (const m of colorPairs) {
      colors[m[1]] = m[2]
    }
  }

  // Extract fontFamily: sans: ['Inter', ...]
  const fontBlock = content.match(/fontFamily\s*:\s*\{([\s\S]*?)\}/)?.[1]
  if (fontBlock) {
    const fontPairs = fontBlock.matchAll(/(\w+)\s*:\s*\[['"]([^'"]+)['"]/g)
    for (const m of fontPairs) {
      fonts[m[1]] = m[2]
    }
  }

  // Extract borderRadius
  const radiusMatch = content.match(/borderRadius\s*:\s*\{[^}]*(?:DEFAULT|lg)\s*:\s*['"]([^'"]+)['"]/)
  if (radiusMatch) borderRadius = radiusMatch[1]

  // Extract spacing base
  const spacingMatch = content.match(/spacing\s*:\s*\{[^}]*(?:DEFAULT|1|base)\s*:\s*['"]([^'"]+)['"]/)
  if (spacingMatch) spacing = spacingMatch[1]

  return { colors, fonts, borderRadius, spacing }
}

function parseCssVariables(content: string): Omit<DesignTokens, 'source'> | null {
  const colors: Record<string, string> = {}
  const fonts: Record<string, string> = {}
  let borderRadius: string | null = null
  let spacing: string | null = null

  // Match --color-* or --*-color CSS custom properties
  const colorVars = content.matchAll(/--(?:color-)?(\w[\w-]*?):\s*([^;}\n]+)/g)
  for (const m of colorVars) {
    const name = m[1].trim()
    const value = m[2].trim()
    // Only include if value looks like a color (hex, rgb, hsl, oklch, or named)
    if (/^(#|rgb|hsl|oklch|color\(|var\()/.test(value) || /^\d/.test(value)) {
      colors[name] = value
    }
  }

  // Match --font-* properties
  const fontVars = content.matchAll(/--font-(\w[\w-]*):\s*([^;}\n]+)/g)
  for (const m of fontVars) {
    fonts[m[1].trim()] = m[2].trim().replace(/['"]/g, '')
  }

  // Match --radius
  const radiusVar = content.match(/--radius\s*:\s*([^;}\n]+)/)
  if (radiusVar) borderRadius = radiusVar[1].trim()

  // Match --spacing
  const spacingVar = content.match(/--spacing\s*:\s*([^;}\n]+)/)
  if (spacingVar) spacing = spacingVar[1].trim()

  return { colors, fonts, borderRadius, spacing }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/services/project-profile.ts
git commit -m "feat(soul): add design system token reader"
```

---

### Task 4: Add dependency summary scanner and main generateProjectProfile function

**Files:**
- Modify: `src/main/services/project-profile.ts` (add sub-scanner 4 + main export)

**Step 1: Add the dependency categorizer and main function**

Append after `parseCssVariables`:

```ts
// ── Sub-scanner 4: Dependency Summary ───────────────────────────────

const DEP_CATEGORIES: Array<{
  category: keyof DependencySummary
  patterns: Array<{ match: string | RegExp; label: string }>
}> = [
  {
    category: 'ui',
    patterns: [
      { match: '@radix-ui/', label: 'Radix UI' },
      { match: '@shadcn/', label: 'shadcn/ui' },
      { match: '@mui/', label: 'MUI' },
      { match: '@chakra-ui/', label: 'Chakra UI' },
      { match: '@headlessui/', label: 'Headless UI' },
      { match: '@mantine/', label: 'Mantine' },
      { match: 'antd', label: 'Ant Design' },
      { match: 'framer-motion', label: 'Framer Motion' },
    ],
  },
  {
    category: 'auth',
    patterns: [
      { match: 'next-auth', label: 'NextAuth.js' },
      { match: '@clerk/', label: 'Clerk' },
      { match: '@supabase/auth-helpers', label: 'Supabase Auth' },
      { match: '@auth/', label: 'Auth.js' },
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
      { match: '@planetscale/', label: 'PlanetScale' },
      { match: 'firebase', label: 'Firebase' },
      { match: '@firebase/', label: 'Firebase' },
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
      { match: '@testing-library/', label: 'Testing Library' },
      { match: 'playwright', label: 'Playwright' },
      { match: '@playwright/', label: 'Playwright' },
      { match: 'cypress', label: 'Cypress' },
    ],
  },
]

function summarizeDependencies(projectPath: string): DependencySummary {
  const result: DependencySummary = { ui: [], auth: [], database: [], state: [], testing: [] }

  try {
    const pkg: PackageJson = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'))
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })

    for (const { category, patterns } of DEP_CATEGORIES) {
      const seen = new Set<string>()
      for (const { match, label } of patterns) {
        if (seen.has(label)) continue
        const found = typeof match === 'string'
          ? allDeps.some((d) => d === match || d.startsWith(match))
          : allDeps.some((d) => match.test(d))
        if (found) {
          seen.add(label)
          result[category].push(label)
        }
      }
    }
  } catch { /* no package.json */ }

  return result
}

// ── Main Export ──────────────────────────────────────────────────────

export function generateProjectProfile(projectPath: string): ProjectProfile {
  const { framework, frameworkVersion, packageManager, devPort, language, keyDirectories } =
    scanFrameworkAndStructure(projectPath)

  const components = scanComponentInventory(projectPath, framework)
  const designSystem = readDesignTokens(projectPath)
  const dependencies = summarizeDependencies(projectPath)

  return {
    framework,
    frameworkVersion,
    packageManager,
    devPort,
    language,
    keyDirectories,
    components,
    designSystem,
    dependencies,
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/services/project-profile.ts
git commit -m "feat(soul): add dependency scanner and main generateProjectProfile"
```

---

### Task 5: Add renderProjectProfile markdown renderer

**Files:**
- Modify: `src/main/services/project-profile.ts` (add markdown renderer)

**Step 1: Add the markdown rendering function**

Append after `generateProjectProfile`:

```ts
// ── Markdown Renderer ───────────────────────────────────────────────

export function renderProjectProfile(profile: ProjectProfile): string {
  const lines: string[] = [
    '## Project Profile (auto-detected)',
    '',
  ]

  // Framework line
  if (profile.framework) {
    const version = profile.frameworkVersion ? ` ${profile.frameworkVersion}` : ''
    lines.push(`- **Framework:** ${profile.framework}${version}`)
  }
  lines.push(`- **Package Manager:** ${profile.packageManager}`)
  lines.push(`- **Dev Port:** ${profile.devPort}`)
  lines.push(`- **Language:** ${profile.language === 'typescript' ? 'TypeScript' : 'JavaScript'}`)

  // Key directories
  if (profile.keyDirectories.length > 0) {
    lines.push('')
    lines.push('### Key Directories')
    for (const dir of profile.keyDirectories) {
      lines.push(`- \`${dir}/\``)
    }
  }

  // Components
  const totalComponents = profile.components.reduce((sum, g) => sum + g.items.length + g.overflow, 0)
  if (totalComponents > 0) {
    lines.push('')
    lines.push(`### Components (${totalComponents} found)`)
    for (const group of profile.components) {
      const overflow = group.overflow > 0 ? ` (+ ${group.overflow} more)` : ''
      lines.push(`- **${group.group}:** ${group.items.join(', ')}${overflow}`)
    }
  }

  // Design system
  if (profile.designSystem) {
    const ds = profile.designSystem
    lines.push('')
    lines.push(`### Design System (from ${ds.source === 'tailwind-config' ? 'Tailwind config' : 'CSS variables'})`)

    const colorEntries = Object.entries(ds.colors).slice(0, 8)
    if (colorEntries.length > 0) {
      lines.push(`- **Colors:** ${colorEntries.map(([k, v]) => `${k}: ${v}`).join(' | ')}`)
    }

    const fontEntries = Object.entries(ds.fonts).slice(0, 4)
    if (fontEntries.length > 0) {
      lines.push(`- **Fonts:** ${fontEntries.map(([k, v]) => `${k}: ${v}`).join(', ')}`)
    }

    if (ds.borderRadius) lines.push(`- **Border Radius:** ${ds.borderRadius}`)
    if (ds.spacing) lines.push(`- **Spacing Base:** ${ds.spacing}`)
  }

  // Dependencies
  const depCategories = (['ui', 'auth', 'database', 'state', 'testing'] as const)
    .filter((cat) => profile.dependencies[cat].length > 0)
  if (depCategories.length > 0) {
    lines.push('')
    lines.push('### Key Dependencies')
    for (const cat of depCategories) {
      const label = cat.charAt(0).toUpperCase() + cat.slice(1)
      lines.push(`- **${label}:** ${profile.dependencies[cat].join(', ')}`)
    }
  }

  return lines.join('\n')
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/services/project-profile.ts
git commit -m "feat(soul): add renderProjectProfile markdown renderer"
```

---

### Task 6: Integrate dynamic profile + soul into config-writer

**Files:**
- Modify: `src/main/mcp/config-writer.ts`

**Step 1: Add imports at the top of config-writer.ts**

After the existing imports (line 4), add:

```ts
import { generateProjectProfile, renderProjectProfile } from '../services/project-profile'
import type { ProjectProfile } from '../services/project-profile'
```

**Step 2: Add the soul template constant**

After the `CANVAS_CLAUDE_MD` array (after line 130), add:

```ts
const SOUL_TEMPLATE = `<!--
# Project Soul

Uncomment and customize any section below. Claude reads this
file every session to understand your preferences.

## Design Taste
- I prefer [minimal / bold / playful / corporate] aesthetics
- Dark mode first / Light mode first / Both equally
- Rounded corners, soft shadows, generous whitespace
- Animations: subtle and purposeful, no bounce effects

## Coding Style
- Prefer Tailwind utility classes over CSS modules
- Always use TypeScript strict mode
- Collocate tests next to source files
- Prefer named exports over default exports

## Brand
- Primary brand color: #___
- Voice: [friendly / professional / technical / casual]
- Never use Lorem Ipsum — use realistic placeholder content

## Workflow
- Always preview in gallery before building into the project
- Create checkpoints after every significant change
- When I say "make it pop", I mean add subtle hover animations and depth
-->`
```

**Step 3: Add readSoulFile and ensureSoulTemplate functions**

After the `SOUL_TEMPLATE` constant:

```ts
function readSoulFile(projPath: string): string | null {
  const soulPath = join(projPath, 'soul.md')
  if (!existsSync(soulPath)) return null

  try {
    const content = readFile(soulPath, 'utf-8')
    // Note: readFile here is async — use readFileSync for synchronous read
    // Actually config-writer uses async readFile from 'node:fs/promises'
    // We need to make this async too
  } catch {
    return null
  }
}
```

Wait — `config-writer.ts` uses `readFile` from `node:fs/promises` (async). Since `writeMcpConfig` is already async, we can keep `readSoulFile` async. Let me correct:

```ts
async function readSoulFile(projPath: string): Promise<string | null> {
  const soulPath = join(projPath, 'soul.md')
  if (!existsSync(soulPath)) return null

  try {
    const content = await readFile(soulPath, 'utf-8')
    const trimmed = content.trim()
    // Skip if entire file is still the commented-out template
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->') && !trimmed.includes('-->\n')) {
      return null
    }
    return content
  } catch {
    return null
  }
}

async function ensureSoulTemplate(projPath: string): Promise<void> {
  const soulPath = join(projPath, 'soul.md')
  if (existsSync(soulPath)) return
  await writeFile(soulPath, SOUL_TEMPLATE + '\n', 'utf-8')
}
```

**Step 4: Update writeCanvasClaudeMd signature and body**

Replace the existing `writeCanvasClaudeMd` function (line 336-352):

```ts
async function writeCanvasClaudeMd(
  projPath: string,
  profile: ProjectProfile,
  soul: string | null
): Promise<void> {
  const claudeMdPath = join(projPath, 'CLAUDE.md')

  // Build dynamic CLAUDE.md from three parts
  const parts: string[] = []

  // Part 1: Dynamic project profile
  parts.push(renderProjectProfile(profile))

  // Part 2: User soul (if exists and has content)
  if (soul) {
    parts.push('')
    parts.push('## Project Soul')
    parts.push('')
    parts.push(soul.trim())
  }

  // Part 3: Static canvas instructions (unchanged)
  parts.push('')
  parts.push(CANVAS_CLAUDE_MD)

  const fullContent = parts.join('\n')

  // Always overwrite to ensure latest instructions
  if (existsSync(claudeMdPath)) {
    const content = await readFile(claudeMdPath, 'utf-8')
    if (content.includes('# Claude Canvas Environment')) {
      const before = content.split('# Claude Canvas Environment')[0]
      await writeFile(claudeMdPath, before.trimEnd() + '\n\n' + fullContent + '\n', 'utf-8')
      return
    }
    await appendFile(claudeMdPath, '\n' + fullContent + '\n')
  } else {
    await writeFile(claudeMdPath, fullContent + '\n', 'utf-8')
  }
}
```

**Step 5: Update writeMcpConfig to use the new pipeline**

Replace lines 175-178 in `writeMcpConfig`:

```ts
  // FROM:
  // await writeCanvasClaudeMd(projPath)
  // await ensureGitignore(projPath)

  // TO:
  const profile = generateProjectProfile(projPath)
  const soul = await readSoulFile(projPath)
  await writeCanvasClaudeMd(projPath, profile, soul)
  await ensureSoulTemplate(projPath)
  await ensureGitignore(projPath)
```

**Step 6: Update ensureGitignore to include soul.md**

Change the entries array in `ensureGitignore` (line 356):

```ts
  // FROM:
  const entries = ['CLAUDE.md', '.claude/screenshots/']

  // TO:
  const entries = ['CLAUDE.md', 'soul.md', '.claude/screenshots/']
```

**Step 7: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 8: Commit**

```bash
git add src/main/mcp/config-writer.ts
git commit -m "feat(soul): integrate dynamic profile + soul into CLAUDE.md generation"
```

---

### Task 7: Add richer tool responses

**Files:**
- Modify: `src/main/mcp/tools.ts`

**Step 1: Import generateProjectProfile at the top of tools.ts**

After the existing imports (after line 10):

```ts
import { generateProjectProfile } from '../services/project-profile'
```

**Step 2: Cache the profile in registerMcpTools**

At the start of `registerMcpTools` function body (after line 59):

```ts
  // Cache project profile for richer tool responses
  const profile = generateProjectProfile(projectPath)
  const componentCount = profile.components.reduce((sum, g) => sum + g.items.length + g.overflow, 0)
  const frameworkLabel = profile.framework || 'unknown'
```

**Step 3: Enhance canvas_start_preview response**

Replace the return text in `canvas_start_preview` (line 86):

```ts
      // FROM:
      return { content: [{ type: 'text', text: 'Dev server starting. The canvas panel will open with a live preview.' }] }

      // TO:
      const ctx = [frameworkLabel, `port ${profile.devPort}`, `${componentCount} components`].join(', ')
      return { content: [{ type: 'text', text: `Dev server starting (${ctx}). The canvas panel will open with a live preview.` }] }
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main/mcp/tools.ts
git commit -m "feat(soul): enrich canvas_start_preview response with project context"
```

---

### Task 8: Manual integration test

**Files:** None (testing only)

**Step 1: Start the app in dev mode**

Run: `npm run dev`

**Step 2: Open a test project**

Open any project that has a `package.json` and components. Verify:

1. `CLAUDE.md` is created in the project root with three sections:
   - `## Project Profile (auto-detected)` with framework, PM, port, language
   - `## Project Soul` only if soul.md has uncommented content
   - `# Claude Canvas Environment` (existing static section)
2. `soul.md` is created with the commented-out template
3. `.gitignore` includes `soul.md`
4. The app opens normally (no crashes, no errors in console)

**Step 3: Verify soul.md behavior**

1. Close the project
2. Edit `soul.md` — uncomment the `## Design Taste` section and customize it
3. Re-open the project
4. Check `CLAUDE.md` — it should now include the `## Project Soul` section with the design taste content

**Step 4: Verify richer tool responses**

1. In the Claude terminal, ask Claude to start the dev server
2. The response from `canvas_start_preview` should include framework name, port, and component count

**Step 5: Commit the verified state**

```bash
git add -A
git commit -m "feat(soul): complete dynamic project soul system

- Dynamic project profile: framework, PM, port, components, design tokens, deps
- Soul file: auto-created template at soul.md, persistent across sessions
- Richer MCP tool responses with project context
- CLAUDE.md now generated dynamically per project"
```

---

## Task Summary

| Task | Description | Files | Estimate |
|------|-------------|-------|----------|
| 1 | Types + framework scanner | NEW `project-profile.ts` | 3 min |
| 2 | Component inventory scanner | MOD `component-scanner.ts`, `project-profile.ts` | 3 min |
| 3 | Design system reader | MOD `project-profile.ts` | 4 min |
| 4 | Dependency summary + main function | MOD `project-profile.ts` | 3 min |
| 5 | Markdown renderer | MOD `project-profile.ts` | 3 min |
| 6 | Config writer integration | MOD `config-writer.ts` | 5 min |
| 7 | Richer tool responses | MOD `tools.ts` | 2 min |
| 8 | Manual integration test | None | 5 min |
