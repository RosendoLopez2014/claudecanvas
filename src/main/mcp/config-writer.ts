import { writeFile, unlink, readFile, appendFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const projectPaths = new Set<string>()

const CANVAS_CLAUDE_MD = [
  '# Claude Canvas Environment',
  '',
  'You are inside **Claude Canvas** — a dev environment with a live preview panel. The dev server is running with HMR.',
  '',
  '## CRITICAL RULES',
  '',
  '1. **NEVER run build or dev server commands.** No `npm run build`, `npx vite build`, `npx vite`, `npm run dev`, `npm start`. The dev server is ALREADY running with HMR. Edit a file and it updates instantly.',
  '2. **NEVER use browser/Chrome tools.** No Playwright, no Claude in Chrome, no browser automation. The preview is in the canvas panel.',
  '3. **When you see `[ComponentName]` tags in the message, the user selected those elements in the inspector.** ALWAYS call `canvas_get_context` first. It returns `count` and `elements[]` — one entry per selected element, each with filePath, lineNumber, props, textContent, styles, componentChain. Read each file and edit accordingly.',
  '4. **Handle multi-element requests.** If the user says "Make [A] match [B]", both elements are in `elements[]`. Read both files, then make [A] look like [B]. Modify ONLY the selected instances — use props to identify which instance when a component appears multiple times.',
  '5. **Be fast.** Call `canvas_get_context` → Read file(s) → Edit → Done. No searching, no screenshots, no extra tool calls. HMR handles the preview update.',
  '',
  '## Canvas MCP Tools',
  '',
  '- `canvas_get_context` — **Call this first** when you see `[ComponentName]` — returns file path, props, styles, text',
  '- `canvas_start_preview` — Start dev server (ONLY if not already running)',
  '- `canvas_stop_preview` — Stop dev server',
  '- `canvas_set_preview_url` — Change preview URL',
  '- `canvas_render` — Render HTML/CSS in canvas',
  '- `canvas_add_to_gallery` — Add component variant for comparison',
  '- `canvas_checkpoint` — Git checkpoint (appears in Timeline tab)',
  '- `canvas_open_tab` — Switch canvas tab (preview, gallery, timeline, diff)',
  '- `canvas_notify` — Toast notification in the status bar',
  '- `canvas_get_status` — Get canvas state',
  '- `canvas_get_screenshot` — Get user screenshot',
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
  '- **`canvas_checkpoint`** — Call after every significant change (new feature, restyle, refactor). This creates a save point the user can revert to. Message should describe what changed.',
  '- **`canvas_add_to_gallery`** — When generating multiple design variants (e.g., "try 3 button styles"), add each to the gallery so the user can compare side-by-side. Call `canvas_open_tab("gallery")` after.',
  '- **`canvas_notify`** — Call with `type: "success"` after completing an edit, or `type: "error"` if something went wrong.',
  '',
  '## Workflow: Inspector → Context → Edit → Done',
  '',
  '1. User selects element(s) → `[Tag1] [Tag2]` appear in the terminal',
  '2. Call `canvas_get_context` — returns `{ count, elements: [{ filePath, lineNumber, props, ... }, ...] }`',
  '3. Read the file(s) at the returned paths',
  '4. Edit the specific instances matching the context',
  '5. HMR updates preview — all highlights fade when edit lands',
  '6. Call `canvas_checkpoint` with a description of what you changed',
].join('\n')

export async function writeMcpConfig(projPath: string, port: number): Promise<void> {
  projectPaths.add(projPath)
  const mcpServerConfig = {
    'claude-canvas': {
      type: 'url',
      url: `http://127.0.0.1:${port}/mcp`
    }
  }

  // Remove any stale .mcp.json from older sessions (triggers approval prompt)
  const mcpJsonPath = join(projPath, '.mcp.json')
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

  // Write MCP server to ~/.claude.json (trusted path — no approval prompt)
  // Also mark the project as trusted to skip the onboarding wizard.
  // Note: mcpServers in .claude/settings.local.json is silently IGNORED by Claude Code.
  // Only ~/.claude.json and .mcp.json are read for MCP server discovery.
  await writeGlobalClaudeJson(mcpServerConfig, projPath)

  // Write tool auto-approvals to .claude/settings.local.json
  // (permissions.allow DOES work from settings.local.json, only mcpServers is ignored)
  await writeToolPermissions(projPath)

  // Write CLAUDE.md with canvas tool instructions (always overwrite for latest version)
  await writeCanvasClaudeMd(projPath)

  await ensureGitignore(projPath)
}

export async function removeMcpConfig(): Promise<void> {
  if (projectPaths.size === 0) return

  // Clean up all tracked project/worktree paths
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

  // Remove MCP server from ~/.claude.json (once, not per-path)
  await removeFromGlobalClaudeJson()
  projectPaths.clear()
}

/**
 * Write MCP server config to ~/.claude.json — the ONLY trusted location
 * Claude Code reads for MCP servers (besides .mcp.json which shows a prompt).
 */
async function writeGlobalClaudeJson(
  mcpServerConfig: Record<string, unknown>,
  projPath: string
): Promise<void> {
  const claudeJsonPath = join(homedir(), '.claude.json')
  let config: Record<string, unknown> = {}

  if (existsSync(claudeJsonPath)) {
    try {
      config = JSON.parse(await readFile(claudeJsonPath, 'utf-8'))
    } catch {
      console.error('Failed to parse ~/.claude.json, skipping MCP config write')
      return
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
}

/**
 * Remove our MCP server from ~/.claude.json on session end.
 */
async function removeFromGlobalClaudeJson(): Promise<void> {
  const claudeJsonPath = join(homedir(), '.claude.json')
  if (!existsSync(claudeJsonPath)) return

  try {
    const config = JSON.parse(await readFile(claudeJsonPath, 'utf-8'))
    if (config.mcpServers?.['claude-canvas']) {
      delete config.mcpServers['claude-canvas']
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers
      }
      await writeFile(claudeJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    }
  } catch {
    // Ignore parse errors — don't corrupt the global config
  }
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
    'mcp__claude-canvas__canvas_get_screenshot',
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

async function writeCanvasClaudeMd(projPath: string): Promise<void> {
  const claudeMdPath = join(projPath, 'CLAUDE.md')

  // Always overwrite to ensure latest instructions
  if (existsSync(claudeMdPath)) {
    const content = await readFile(claudeMdPath, 'utf-8')
    if (content.includes('# Claude Canvas Environment')) {
      // Replace the existing canvas section with the latest version
      const before = content.split('# Claude Canvas Environment')[0]
      await writeFile(claudeMdPath, before.trimEnd() + '\n\n' + CANVAS_CLAUDE_MD + '\n', 'utf-8')
      return
    }
    await appendFile(claudeMdPath, '\n' + CANVAS_CLAUDE_MD + '\n')
  } else {
    await writeFile(claudeMdPath, CANVAS_CLAUDE_MD + '\n', 'utf-8')
  }
}

async function ensureGitignore(projPath: string): Promise<void> {
  const gitignorePath = join(projPath, '.gitignore')
  const entries = ['CLAUDE.md', '.claude/screenshots/']

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
