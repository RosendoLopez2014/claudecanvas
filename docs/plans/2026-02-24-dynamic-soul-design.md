# Dynamic Project Soul — Design Document

**Date:** 2026-02-24
**Status:** Approved
**Approach:** A — Single-File Pipeline (sync at project open)

## Problem

When a user opens a project in Claude Canvas, Claude receives a static 130-line CLAUDE.md that is identical for every project. A Next.js SaaS app and a vanilla HTML page get the same instructions. Claude has zero awareness of:

- What framework or language the project uses
- What components already exist
- What the design system looks like (colors, fonts, spacing)
- What key dependencies are installed
- The user's personal coding and design preferences

This means Claude's first several messages are spent discovering context that the app already knows. Gallery previews don't match the app's visual identity. Claude suggests components that already exist. It proposes libraries the project doesn't use.

## Solution

Three changes that give Claude full project awareness from the first message:

1. **Dynamic Project Profile** — auto-generated intelligence about the project
2. **Soul File** — user-authored preferences and personality (persistent across sessions)
3. **Richer Tool Responses** — passive context in MCP tool return values

## Architecture

### Data Flow

```
Project Opens
     │
     ▼
writeMcpConfig(projPath, port)
     │
     ├──▶ generateProjectProfile(projPath)     ← NEW
     │         │
     │         ├── resolveDevServerPlan()       (framework, PM, port)
     │         ├── scanComponents()             (component inventory)
     │         ├── readDesignTokens()           (Tailwind/CSS vars)
     │         └── summarizeDependencies()      (key deps by category)
     │                   │
     │                   ▼
     │            ProjectProfile object
     │
     ├──▶ readSoulFile(projPath)               ← NEW
     │         │
     │         ▼
     │    soul.md contents (string | null)
     │
     ├──▶ writeCanvasClaudeMd(projPath, profile, soul)
     │         │
     │         ▼
     │    CLAUDE.md = [profile] + [soul] + [static instructions]
     │
     ├──▶ ensureSoulTemplate(projPath)          ← NEW
     │         │
     │         ▼
     │    soul.md (created if missing, never overwritten)
     │
     ├──▶ writeGlobalClaudeJson(...)           (unchanged)
     ├──▶ writeToolPermissions(...)            (unchanged)
     └──▶ ensureGitignore(...)                 (add soul.md)
```

### CLAUDE.md Structure

The generated CLAUDE.md has three sections, concatenated:

```
┌─────────────────────────────────┐
│ 1. Project Profile (dynamic)    │  ← from ProjectProfile
│    - Framework, PM, port, lang  │
│    - Key directories            │
│    - Component map              │
│    - Design system tokens       │
│    - Key dependencies           │
├─────────────────────────────────┤
│ 2. Project Soul (user-authored) │  ← from soul.md
│    - Design taste               │
│    - Coding preferences         │
│    - Brand personality          │
│    - Workflow preferences       │
├─────────────────────────────────┤
│ 3. Canvas Instructions (static) │  ← existing, unchanged
│    - Critical rules             │
│    - Tool reference             │
│    - Workflow patterns           │
└─────────────────────────────────┘
```

Total output: ~160-200 lines depending on project size (vs 130 today).

---

## Component 1: Project Profile Generator

### New File: `src/main/services/project-profile.ts`

Exports a single synchronous function:

```ts
interface ProjectProfile {
  framework: string | null        // "nextjs", "vite", "astro", etc.
  frameworkVersion: string | null  // "14.1.0" (from package.json dep version)
  packageManager: string          // "pnpm"
  devPort: number                 // 3000
  language: 'typescript' | 'javascript'
  keyDirectories: string[]        // ["src/app", "src/components", "src/lib"]
  components: ComponentGroup[]    // grouped by parent dir
  designSystem: DesignTokens | null
  dependencies: DependencySummary
}

interface ComponentGroup {
  group: string       // "UI", "Auth", "Layout"
  items: string[]     // ["Button", "Card", "Modal"]
  overflow: number    // items beyond display cap
}

interface DesignTokens {
  source: 'tailwind-config' | 'css-variables'
  colors: Record<string, string>     // { primary: "#3B82F6", ... }
  fonts: Record<string, string>      // { sans: "Inter", mono: "JetBrains Mono" }
  borderRadius: string | null        // "0.5rem"
  spacing: string | null             // "4px"
}

interface DependencySummary {
  ui: string[]        // ["shadcn/ui", "Radix UI"]
  auth: string[]      // ["next-auth"]
  database: string[]  // ["Supabase", "Prisma"]
  state: string[]     // ["Zustand"]
  testing: string[]   // ["Vitest"]
  other: string[]     // notable deps that don't fit categories
}
```

### Four Sub-Scanners

#### 1. Framework + Structure

- Calls `resolveDevServerPlan(projectPath)` for framework ID, package manager, and port
- Reads framework version from `package.json` dependencies (e.g., `"next": "14.1.0"`)
- Checks for `tsconfig.json` → TypeScript, else JavaScript
- Runs `readdirSync` on `src/` (or project root if no `src/`) to find key directories
- Only lists directories that exist: `app`, `pages`, `components`, `lib`, `utils`, `hooks`, `styles`, `api`, `server`, `public`

#### 2. Component Inventory

- Reuses scan logic from `component-scanner.ts` (extract into shared function)
- Scans `src/components/` (and `src/app/` for page components if Next.js)
- Groups by parent directory name (PascalCase)
- Caps at 50 component names total (to keep CLAUDE.md readable)
- Tracks overflow: `"UI: Button, Card, Modal (+ 12 more)"`

#### 3. Design System Reader

Reads in priority order, stops at first match:

**Tailwind Config** (`tailwind.config.ts` / `.js` / `.mjs`):
- Regex-extracts from `theme.extend` block:
  - `colors: { primary: '...' }` → color tokens
  - `fontFamily: { sans: ['Inter'] }` → font tokens
  - `borderRadius: { lg: '0.5rem' }` → radius token
- Also checks for CSS-in-Tailwind v4 pattern: `@theme { --color-primary: #... }` in `globals.css`

**CSS Custom Properties** (`globals.css`, `app.css`, `variables.css`):
- Scans for `--color-*`, `--font-*`, `--radius-*` declarations
- Groups into color/font/radius buckets

Falls back to `null` if neither found. No errors — just no design section in CLAUDE.md.

#### 4. Dependency Summary

Reads `package.json` `dependencies` + `devDependencies`. Maps known packages to categories:

| Category | Packages |
|----------|----------|
| UI | `@radix-ui/*`, `@shadcn/*`, `@mui/*`, `@chakra-ui/*`, `@headlessui/*`, `@mantine/*`, `antd` |
| Auth | `next-auth`, `@clerk/*`, `@supabase/auth-helpers`, `passport`, `lucia` |
| Database | `@supabase/supabase-js`, `prisma`, `drizzle-orm`, `mongoose`, `typeorm`, `@planetscale/*` |
| State | `zustand`, `@reduxjs/toolkit`, `jotai`, `recoil`, `valtio`, `mobx` |
| Testing | `vitest`, `jest`, `@testing-library/*`, `playwright`, `cypress` |

Only populated categories appear in the output.

### Performance

All four scanners use synchronous filesystem reads (`readFileSync`, `readdirSync`, `existsSync`). No network calls. Expected time:

- Small project (<20 components): ~50ms
- Medium project (50-100 components): ~100ms
- Large project (200+ components): ~200ms

Component scan is capped at 50 names, so output size is bounded regardless of project size.

---

## Component 2: Soul File

### Location

`soul.md` in the project root, next to `CLAUDE.md`.

### Creation

Auto-created by `ensureSoulTemplate(projPath)` on first project open if `soul.md` doesn't exist. The template is entirely wrapped in HTML comments so it contributes nothing to Claude's context until the user uncomments sections.

### Template Content

```markdown
<!--
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
-->
```

### Reading Logic

In `writeCanvasClaudeMd()`:

1. Check if `soul.md` exists → if not, skip (no soul section)
2. Read file contents
3. If entire content is wrapped in `<!-- ... -->` (untouched template) → skip
4. Otherwise, inject under `## Project Soul` header in CLAUDE.md

### Lifecycle Rules

- **Never overwritten** if it already exists
- **Gitignored by default** — added alongside `CLAUDE.md` in `.gitignore`
- **No validation** — freeform markdown, Claude reads as natural language
- **Not ephemeral** — unlike CLAUDE.md, `soul.md` persists across sessions and app restarts
- **Not cleaned up** on app close — `removeMcpConfig()` does NOT touch `soul.md`

---

## Component 3: Richer Tool Responses

Three MCP tools get enhanced return values. Changes are minimal (1-2 lines each in `tools.ts`).

### `canvas_start_preview`

Current return:
```
"Dev server starting. The canvas panel will open with a live preview."
```

Enhanced return:
```
"Dev server starting (Next.js, port 3000, 47 components detected). The canvas panel will open with a live preview."
```

Implementation: the `registerMcpTools` function already receives `projectPath`. Call `generateProjectProfile(projectPath)` once at registration time and store the result. Reference `profile.framework`, `profile.devPort`, `profile.components` count in the response string.

### `canvas_get_status`

Add `componentCount` and `lastCheckpoint` to the `__canvasState` window global (set by `useMcpStateExposer`).

### `canvas_get_errors`

Add `lastEditedFile` to the response when errors are present, so Claude knows which file to fix without an extra Read call. Requires tracking last-edited file in `__canvasState` (set when file watcher detects a write).

---

## Component 4: Config Writer Changes

### Modified File: `src/main/mcp/config-writer.ts`

#### `writeMcpConfig(projPath, port)` — updated flow

```
1. Register MCP server in ~/.claude.json          (unchanged)
2. Write tool permissions                          (unchanged)
3. generateProjectProfile(projPath)                (NEW)
4. readSoulFile(projPath)                          (NEW)
5. writeCanvasClaudeMd(projPath, profile, soul)    (CHANGED — now dynamic)
6. ensureSoulTemplate(projPath)                    (NEW)
7. ensureGitignore(projPath)                       (CHANGED — add soul.md)
```

#### `writeCanvasClaudeMd(projPath, profile, soul)` — updated signature

Builds CLAUDE.md from three parts:

1. `renderProjectProfile(profile)` → markdown string for project profile section
2. `soul` → raw string from soul.md (or empty)
3. `CANVAS_CLAUDE_MD` → existing static instructions (unchanged)

#### `ensureSoulTemplate(projPath)` — new function

Creates `soul.md` with commented template if it doesn't exist. Does nothing if it already exists.

#### `ensureGitignore(projPath)` — updated

Add `soul.md` to the gitignored entries list alongside `CLAUDE.md` and `.claude/screenshots/`.

#### `removeMcpConfig()` — unchanged for soul.md

`soul.md` is NOT deleted on app close. Only `CLAUDE.md` is cleaned up (as today).

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/services/project-profile.ts` | **NEW** — ProfileGenerator with 4 sub-scanners |
| `src/main/services/component-scanner.ts` | **MODIFIED** — export `scanDirectory` for reuse |
| `src/main/mcp/config-writer.ts` | **MODIFIED** — dynamic CLAUDE.md, soul reader, soul template |
| `src/main/mcp/tools.ts` | **MODIFIED** — richer responses for 3 tools |
| `src/renderer/hooks/useMcpStateExposer.ts` | **MODIFIED** — add componentCount, lastCheckpoint to window global |

## Files NOT Changed

- `src/main/mcp/server.ts` — MCP transport layer, untouched
- `src/main/index.ts` — `writeMcpConfig()` call signature unchanged (still `projPath, port`)
- `src/main/devserver/resolve.ts` — consumed, not modified
- Static `CANVAS_CLAUDE_MD` instructions — preserved verbatim as section 3

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Tailwind config parsing fails (complex configs) | Regex-based, falls back to `null`. No errors, just no design section. |
| Component scan slow on huge monorepos | Capped at 50 names, MAX_DEPTH=5 already enforced. Bounded at ~200ms. |
| Soul file contains prompt injection | Same trust model as existing CLAUDE.md — user controls their own project files. |
| CLAUDE.md gets too long | Profile section is capped (~40 lines max). Soul is user-controlled. Static section is fixed at 130 lines. |
