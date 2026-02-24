import { writeFile, unlink, readFile, appendFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateProjectProfile, renderProjectProfile } from '../services/project-profile'

const projectPaths = new Set<string>()

const CANVAS_CLAUDE_MD = [
  '# Claude Canvas Environment',
  '',
  'You are inside **Claude Canvas** — a dev environment with a live preview panel. The dev server is running with HMR.',
  '',
  '## CRITICAL RULES',
  '',
  '1. **NEVER run build or dev server commands.** No `npm run build`, `npx vite build`, `npx vite`, `npm run dev`, `npm start`. The dev server is ALREADY running with HMR. Edit a file and it updates instantly.',
  '2. **NEVER use Playwright, browser automation, or any browser MCP tools.** No `playwright`, no `browser_navigate`, no `browser_click`, no `browser_evaluate`, no `browser_snapshot`, no Chrome DevTools, no `puppeteer`. These tools DO NOT interact with the canvas panel. All canvas interaction goes through the `canvas_*` MCP tools listed below. If you have a Playwright MCP server available, IGNORE it entirely — it cannot access the canvas.',
  '3. **The gallery is a built-in panel, not a web page.** To show something in the gallery, call `canvas_add_to_gallery` with self-contained HTML/CSS. To view it, call `canvas_open_tab("gallery")`. There is NO other way to add items to the gallery. NEVER try to inject content via JavaScript execution, DOM manipulation, or browser automation.',
  '4. **When you see `[ComponentName]` tags in the message, the user selected those elements in the inspector.** ALWAYS call `canvas_get_context` first. It returns `count` and `elements[]` — one entry per selected element, each with filePath, lineNumber, props, textContent, styles, componentChain. Read each file and edit accordingly.',
  '5. **Handle multi-element requests.** If the user says "Make [A] match [B]", both elements are in `elements[]`. Read both files, then make [A] look like [B]. Modify ONLY the selected instances — use props to identify which instance when a component appears multiple times.',
  '6. **Be fast.** Call `canvas_get_context` → Read file(s) → Edit → Done. No searching, no screenshots, no extra tool calls. HMR handles the preview update.',
  '',
  '## Canvas MCP Tools',
  '',
  '- `canvas_get_context` — **Call this first** when you see `[ComponentName]` — returns file path, props, styles, text',
  '- `canvas_start_preview` — Start dev server (ONLY if not already running)',
  '- `canvas_stop_preview` — Stop dev server',
  '- `canvas_set_preview_url` — Change preview URL',
  '- `canvas_render` — Render HTML/CSS in canvas',
  '- `canvas_add_to_gallery` — **THE way to show things in the gallery.** Pass self-contained HTML/CSS. Call this when user says "show in gallery", "add to gallery", "compare variants", or "show me options"',
  '- `canvas_checkpoint` — Git checkpoint (appears in Timeline tab)',
  '- `canvas_open_tab` — Switch canvas tab (preview, gallery, timeline, diff)',
  '- `canvas_notify` — Toast notification in the status bar',
  '- `canvas_get_status` — Get canvas state',
  '- `canvas_get_errors` — **Check runtime errors** from the live preview. Returns parsed errors with message, file, line, and column. Call this after edits to verify nothing broke.',
  '- `canvas_get_screenshot` — Get user screenshot',
  '- `canvas_auto_screenshot` — Capture a screenshot of the current canvas preview automatically',
  '- `canvas_get_context_minimal` — Lightweight version of canvas_get_context (only filePath, lineNumber, componentName). Call this first, use full version only when you need props/styles.',
  '- `canvas_is_dev_running` — Check if the dev server is currently running',
  '- `canvas_get_preview_url` — Get the current preview URL',
  '- `canvas_get_active_tab` — Get which canvas tab is active',
  '- `canvas_design_session` — Start/end/select/get_status for design sessions',
  '- `canvas_get_selection` — Get user\'s selected variant from gallery',
  '- `canvas_update_variant` — Update variant metadata/content',
  '',
  '## Supabase Tools',
  '',
  'If the project is connected to Supabase (check the Supabase icon in the top-right):',
  '',
  '- `supabase_list_tables` — See current database schema (tables + columns)',
  '- `supabase_run_sql` — Execute SQL (CREATE TABLE, ALTER, INSERT, SELECT, RLS policies)',
  '- `supabase_get_schema` — Full DDL dump of all tables',
  '- `supabase_get_rls_policies` — List all RLS policies',
  '- `supabase_list_functions` — List Edge Functions',
  '- `supabase_list_buckets` — List storage buckets',
  '- `supabase_get_connection_info` — Get API URL, keys, and database URL',
  '- `supabase_list_projects` — List all projects',
  '',
  '### Migration Workflow',
  '',
  '1. Call `supabase_list_tables` to understand current schema',
  '2. Write migration SQL file to `supabase/migrations/YYYYMMDDHHMMSS_description.sql`',
  '3. Call `supabase_run_sql` with the migration SQL to apply it',
  '4. Call `supabase_list_tables` to verify the change',
  '5. Call `canvas_checkpoint` with a description of the migration',
  '',
  '## Proactive Tool Usage',
  '',
  '**Use these tools automatically — do NOT wait to be asked:**',
  '',
  '- **`canvas_get_errors`** — Call after every edit to check for runtime errors in the preview. If errors are returned, fix them immediately before moving on. This catches React warnings, crashes, and unhandled exceptions from the running app.',
  '- **`canvas_checkpoint`** — Call after every significant change (new feature, restyle, refactor). This creates a save point the user can revert to. Message should describe what changed.',
  '- **`canvas_add_to_gallery`** — When generating multiple design variants (e.g., "try 3 button styles"), add each to the gallery so the user can compare side-by-side. Call `canvas_open_tab("gallery")` after.',
  '- **`canvas_notify`** — Call with `type: "success"` after completing an edit, or `type: "error"` if something went wrong.',
  '',
  '## Workflow: Creating Visual Components',
  '',
  '**IMPORTANT:** When the user asks you to create, build, or design a visual component (UI element, animation, visualizer, widget, etc.), ALWAYS ask them first:',
  '',
  '> "Would you like me to **preview it in the gallery** first, or **build it directly** into your project?"',
  '',
  '- **Preview in gallery** — Create a self-contained HTML/CSS/JS prototype and show it in the gallery. The user can review, request changes, and iterate before any project files are touched. Best for: new designs, experimental ideas, things the user hasn\'t seen yet.',
  '- **Build directly** — Write the production component and wire it into the app. Best for: well-defined requirements, simple additions, when the user says "just build it".',
  '',
  'If the user says "show me first", "preview it", "let me see it", "demo it", or "gallery" — always go the gallery route.',
  'If the user says "just build it", "add it to the app", or "wire it in" — go the direct route.',
  'When in doubt, default to **gallery preview first** — it\'s easier to promote a preview to production code than to undo code already written.',
  '',
  '## Workflow: Show in Gallery',
  '',
  'When showing a component in the gallery (either by user request or as a preview step):',
  '',
  '1. Create a **self-contained HTML/CSS snippet** of the component (inline `<style>`, no imports, no external deps)',
  '2. If the component uses JavaScript (animations, Canvas, interactivity), include a `<script>` tag in the HTML',
  '3. Call `canvas_add_to_gallery({ label: "Component Name", html: "...", css: "...", description: "..." })`',
  '4. Call `canvas_open_tab("gallery")`',
  '5. Ask the user: "Here\'s the preview in the gallery. Want me to build it into your project, iterate on it, or try a different approach?"',
  '',
  'The HTML must be fully self-contained — include all CSS inline, use system fonts, embed SVGs directly.',
  'Do NOT use React, imports, or any framework — the gallery renders raw HTML in an iframe.',
  '',
  '## Workflow: Inspector → Context → Edit → Done',
  '',
  '1. User selects element(s) → `[Tag1] [Tag2]` appear in the terminal',
  '2. Call `canvas_get_context` — returns `{ count, elements: [{ filePath, lineNumber, props, ... }, ...] }`',
  '3. Read the file(s) at the returned paths',
  '4. Edit the specific instances matching the context',
  '5. HMR updates preview — all highlights fade when edit lands',
  '6. Call `canvas_checkpoint` with a description of what you changed',
  '',
  '## Design Exploration',
  '',
  'When the user asks to explore design options (e.g., "show me 3 navigation layouts", "design a login page"):',
  '',
  '1. Start a session: `canvas_design_session({ action: "start", title: "...", prompt: "..." })`',
  '2. Generate 2-4 DISTINCT HTML/CSS mockups',
  '3. For each, call `canvas_add_to_gallery` with full metadata:',
  '   - label, description, pros (2-3), cons (2-3), annotations, sessionId',
  '4. Open the gallery: `canvas_open_tab("gallery")`',
  '5. Tell the user to review and click their preferred option',
  '6. Check selection: `canvas_get_selection()`',
  '7. If refining: generate a new variant with parentId linking to selected',
  '8. If applying: convert HTML mockup to production code for the project\'s framework',
  '',
  '### Design quality rules:',
  '',
  '- Use the project\'s color scheme (check existing CSS/Tailwind config)',
  '- Self-contained HTML/CSS (inline styles or `<style>`, no external deps)',
  '- Realistic content (not Lorem Ipsum)',
  '- Each option must be genuinely different',
].join('\n')

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

export async function writeMcpConfig(projPath: string, port: number): Promise<void> {
  projectPaths.add(projPath)
  const mcpServerConfig = {
    'claude-canvas': {
      type: 'url',
      url: `http://127.0.0.1:${port}/mcp`
    }
  }

  // Write MCP server to ~/.claude.json (trusted path — no approval prompt)
  // Also mark the project as trusted to skip the onboarding wizard.
  // Note: mcpServers in .claude/settings.local.json is silently IGNORED by Claude Code.
  // Only ~/.claude.json and .mcp.json are read for MCP server discovery.
  const wrote = await writeGlobalClaudeJson(mcpServerConfig, projPath)

  const mcpJsonPath = join(projPath, '.mcp.json')
  if (wrote) {
    // Clean up stale .mcp.json from older sessions (triggers approval prompt)
    if (existsSync(mcpJsonPath)) {
      try {
        const content = JSON.parse(await readFile(mcpJsonPath, 'utf-8'))
        if (content?.mcpServers?.['claude-canvas']) {
          await unlink(mcpJsonPath).catch((e: Error) => console.warn('[mcp-config] cleanup:', e.message))
        }
      } catch {
        // Not JSON or unreadable — leave it alone
      }
    }
  } else {
    // Fallback: write .mcp.json in the project directory.
    // Claude Code will show an approval prompt, but the MCP server will work.
    console.log('[mcp-config] using .mcp.json fallback')
    await writeFile(
      mcpJsonPath,
      JSON.stringify({ mcpServers: mcpServerConfig }, null, 2) + '\n',
      'utf-8'
    )
  }

  // Write tool auto-approvals to .claude/settings.local.json
  // (permissions.allow DOES work from settings.local.json, only mcpServers is ignored)
  await writeToolPermissions(projPath)

  // Write CLAUDE.md with dynamic profile, soul, and canvas tool instructions
  const profile = generateProjectProfile(projPath)
  const profileMd = renderProjectProfile(profile)
  const soul = await readSoulFile(projPath)
  await writeCanvasClaudeMd(projPath, profileMd, soul)
  await ensureSoulTemplate(projPath)
  await ensureGitignore(projPath)
}

export async function removeMcpConfig(): Promise<void> {
  if (projectPaths.size === 0) return

  // Clean up project-local files only. We intentionally do NOT touch
  // ~/.claude.json here — doing a read-modify-write on close races with
  // Claude Code's own exit writes and can corrupt auth data. The stale
  // mcpServers entry is harmless (server won't respond when app is closed)
  // and writeMcpConfig() will overwrite it with the correct port on next launch.
  for (const projPath of projectPaths) {
    // Clean up legacy .mcp.json if it exists
    const mcpJsonPath = join(projPath, '.mcp.json')
    if (existsSync(mcpJsonPath)) {
      await unlink(mcpJsonPath).catch((e: Error) => console.warn('[mcp-config] cleanup:', e.message))
    }

    // Clean up CLAUDE.md
    const claudeMdPath = join(projPath, 'CLAUDE.md')
    if (existsSync(claudeMdPath)) {
      try {
        const content = await readFile(claudeMdPath, 'utf-8')
        if (content.startsWith('# Claude Canvas Environment')) {
          await unlink(claudeMdPath).catch((e: Error) => console.warn('[mcp-config] cleanup:', e.message))
        } else if (content.includes('# Claude Canvas Environment')) {
          const cleaned = content.replace(/\n# Claude Canvas Environment[\s\S]*$/, '')
          await writeFile(claudeMdPath, cleaned, 'utf-8')
        }
      } catch { /* file may have been deleted */ }
    }
  }

  projectPaths.clear()
}

/**
 * Write MCP server config to ~/.claude.json — the ONLY trusted location
 * Claude Code reads for MCP servers (besides .mcp.json which shows a prompt).
 */
async function writeGlobalClaudeJson(
  mcpServerConfig: Record<string, unknown>,
  projPath: string
): Promise<boolean> {
  const claudeJsonPath = join(homedir(), '.claude.json')
  let config: Record<string, unknown> = {}

  if (existsSync(claudeJsonPath)) {
    try {
      config = JSON.parse(await readFile(claudeJsonPath, 'utf-8'))
    } catch {
      // File is corrupted — don't overwrite it (would wipe Claude Code settings/auth).
      // Return false so caller can fall back to .mcp.json registration.
      console.warn('~/.claude.json is corrupted — skipping write, will use .mcp.json fallback')
      return false
    }
  }

  const existingMcp = (config.mcpServers as Record<string, unknown>) || {}
  config.mcpServers = { ...existingMcp, ...mcpServerConfig }

  // Mark this project as trusted so Claude Code skips the onboarding/trust wizard.
  // Claude Code stores per-project trust state under projects[projectPath].
  const projects = (config.projects as Record<string, Record<string, unknown>>) || {}
  const projConfig = projects[projPath] || {}
  projConfig.hasTrustDialogAccepted = true
  projConfig.hasCompletedProjectOnboarding = true
  projects[projPath] = projConfig
  config.projects = projects

  await writeFile(claudeJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  return true
}


/**
 * Write tool auto-approvals to .claude/settings.local.json.
 * Includes both MCP canvas tools AND common dev tools (Read, Edit, Write, Bash)
 * so Claude can act immediately without asking for permission.
 */
async function writeToolPermissions(projPath: string): Promise<void> {
  const claudeDir = join(projPath, '.claude')
  if (!existsSync(claudeDir)) {
    await mkdir(claudeDir, { recursive: true })
  }

  const settingsPath = join(claudeDir, 'settings.local.json')
  let settings: Record<string, unknown> = {}

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    } catch {
      // If corrupted, start fresh
    }
  }

  // Remove any stale mcpServers (silently ignored by Claude Code anyway)
  delete settings.mcpServers

  const allowedTools = [
    // Canvas MCP tools
    'mcp__claude-canvas__canvas_render',
    'mcp__claude-canvas__canvas_start_preview',
    'mcp__claude-canvas__canvas_stop_preview',
    'mcp__claude-canvas__canvas_set_preview_url',
    'mcp__claude-canvas__canvas_open_tab',
    'mcp__claude-canvas__canvas_add_to_gallery',
    'mcp__claude-canvas__canvas_checkpoint',
    'mcp__claude-canvas__canvas_notify',
    'mcp__claude-canvas__canvas_get_status',
    'mcp__claude-canvas__canvas_get_context',
    'mcp__claude-canvas__canvas_get_errors',
    'mcp__claude-canvas__canvas_get_screenshot',
    'mcp__claude-canvas__canvas_auto_screenshot',
    'mcp__claude-canvas__canvas_get_context_minimal',
    'mcp__claude-canvas__canvas_is_dev_running',
    'mcp__claude-canvas__canvas_get_preview_url',
    'mcp__claude-canvas__canvas_get_active_tab',
    'mcp__claude-canvas__canvas_design_session',
    'mcp__claude-canvas__canvas_get_selection',
    'mcp__claude-canvas__canvas_update_variant',
    // Supabase MCP tools
    'mcp__claude-canvas__supabase_list_projects',
    'mcp__claude-canvas__supabase_list_tables',
    'mcp__claude-canvas__supabase_run_sql',
    'mcp__claude-canvas__supabase_get_schema',
    'mcp__claude-canvas__supabase_list_functions',
    'mcp__claude-canvas__supabase_list_buckets',
    'mcp__claude-canvas__supabase_get_connection_info',
    'mcp__claude-canvas__supabase_get_rls_policies',
    // Core dev tools — auto-approve so Claude can act immediately
    'Read',
    'Edit',
    'Write',
    'Bash(npm install*)',
    'Bash(npm run*)',
    'Bash(npx *)',
    'Bash(node *)',
    'Bash(git *)',
    'Bash(ls *)',
    'Bash(cat *)',
    'Bash(mkdir *)',
    'Bash(cp *)',
    'Bash(mv *)'
  ]
  const existingAllow = (
    (settings.permissions as Record<string, unknown>)?.allow as string[] || []
  )
  const mergedAllow = [...new Set([...existingAllow, ...allowedTools])]
  settings.permissions = {
    ...((settings.permissions as Record<string, unknown>) || {}),
    allow: mergedAllow
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

async function writeCanvasClaudeMd(
  projPath: string,
  profileMd: string,
  soul: string | null
): Promise<void> {
  const claudeMdPath = join(projPath, 'CLAUDE.md')

  // Build dynamic CLAUDE.md from three parts
  const parts: string[] = []

  // Part 1: Dynamic project profile
  parts.push(profileMd)

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

async function ensureGitignore(projPath: string): Promise<void> {
  const gitignorePath = join(projPath, '.gitignore')
  const entries = ['CLAUDE.md', 'soul.md', '.claude/screenshots/']

  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8')
    const missing = entries.filter((e) => !content.includes(e))
    if (missing.length === 0) return
    await appendFile(
      gitignorePath,
      '\n# Claude Canvas (auto-generated, session-specific)\n' + missing.join('\n') + '\n'
    )
  } else {
    await writeFile(
      gitignorePath,
      '# Claude Canvas (auto-generated, session-specific)\n' + entries.join('\n') + '\n',
      'utf-8'
    )
  }
}
