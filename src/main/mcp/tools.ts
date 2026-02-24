import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { getLatestScreenshotBase64 } from '../screenshot'
import { getSecureToken } from '../services/secure-storage'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDevServerPlan } from '../devserver/resolve'
import { setUserOverride } from '../devserver/config-store'
import { parseCommandString, validateCommand, commandToString } from '../../shared/devserver/types'
import { generateProjectProfile } from '../services/project-profile'

/** Auto-detect Supabase project ref from supabase/config.toml */
async function detectProjectRef(projectPath: string): Promise<string | null> {
  try {
    const configPath = join(projectPath, 'supabase', 'config.toml')
    const content = await readFile(configPath, 'utf-8')
    const match = content.match(/project_id\s*=\s*"([^"]+)"/)
    return match?.[1] || null
  } catch {
    return null
  }
}

type McpTextResult = { content: [{ type: 'text'; text: string }] }
type SupabaseAuth = { token: string; ref: string }

/** Validate Supabase token + resolve project ref, returning an error result on failure. */
async function requireSupabaseAuth(
  projectPath: string,
  projectRef?: string
): Promise<SupabaseAuth | McpTextResult> {
  const token = getSecureToken('supabase')
  if (!token) {
    return { content: [{ type: 'text', text: 'Not connected to Supabase. Ask the user to connect via the Supabase icon in the top-right.' }] }
  }
  const ref = projectRef || await detectProjectRef(projectPath)
  if (!ref) {
    return { content: [{ type: 'text', text: 'No project ref found. Pass projectRef or ensure supabase/config.toml exists.' }] }
  }
  // Parse access token from encrypted compound token (JSON: { accessToken, refreshToken })
  let accessToken: string
  try {
    const parsed = JSON.parse(token) as { accessToken?: string }
    accessToken = parsed.accessToken || token
  } catch {
    accessToken = token
  }
  return { token: accessToken, ref }
}

function isAuthError(result: SupabaseAuth | McpTextResult): result is McpTextResult {
  return 'content' in result
}

export function registerMcpTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  projectPath: string
): void {
  // Cache project profile for richer tool responses
  const profile = generateProjectProfile(projectPath)
  const componentCount = profile.components.reduce((sum, g) => sum + g.items.length + g.overflow, 0)
  const frameworkLabel = profile.framework || 'unknown'

  server.tool(
    'canvas_render',
    'Render HTML/CSS in the canvas panel or inline in the terminal. Auto-opens the canvas if the component is large.',
    {
      html: z.string().describe('HTML content to render'),
      css: z.string().optional().describe('Optional CSS styles')
    },
    async ({ html, css }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:canvas-render', { projectPath, html, css })
      return { content: [{ type: 'text', text: 'Rendered successfully. The component is now visible in the canvas.' }] }
    }
  )

  server.tool(
    'canvas_start_preview',
    'Start the dev server and open a live preview in the canvas panel. The preview auto-updates via HMR as you write code.',
    {
      command: z.string().optional().describe('Dev server command (e.g., "npm run dev"). Auto-detected if omitted.'),
      cwd: z.string().optional().describe('Working directory. Defaults to current project path.')
    },
    async ({ command, cwd }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:start-preview', { projectPath, command, cwd })
      const ctx = [frameworkLabel, `port ${profile.devPort}`, `${componentCount} components`].join(', ')
      return { content: [{ type: 'text', text: `Dev server starting (${ctx}). The canvas panel will open with a live preview.` }] }
    }
  )

  server.tool(
    'canvas_stop_preview',
    'Stop the dev server and close the canvas preview panel.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:stop-preview', { projectPath })
      return { content: [{ type: 'text', text: 'Dev server stopped and preview closed.' }] }
    }
  )

  server.tool(
    'canvas_set_preview_url',
    'Point the canvas preview at a specific URL. Auto-opens the canvas panel.',
    {
      url: z.string().describe('URL to load in the preview iframe (e.g., http://localhost:3000)')
    },
    async ({ url }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:set-preview-url', { projectPath, url })
      return { content: [{ type: 'text', text: `Preview URL set to ${url}. Canvas is now showing the live preview.` }] }
    }
  )

  server.tool(
    'canvas_open_tab',
    'Switch the canvas panel to a specific tab. Auto-opens the canvas if closed.',
    {
      tab: z.enum(['preview', 'gallery', 'timeline', 'diff']).describe('Which tab to open')
    },
    async ({ tab }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:open-tab', { projectPath, tab })
      return { content: [{ type: 'text', text: `Switched to ${tab} tab.` }] }
    }
  )

  server.tool(
    'canvas_add_to_gallery',
    'Add a component variant to the gallery with optional design metadata. Auto-opens the gallery tab.',
    {
      label: z.string().describe('Name for this variant (e.g., "Option A — Sticky Top Nav")'),
      html: z.string().describe('HTML content of the variant'),
      css: z.string().optional().describe('Optional CSS styles'),
      description: z.string().optional().describe('1-3 sentence explanation of this design option'),
      category: z.string().optional().describe('Design category (e.g., "navigation", "auth", "landing")'),
      pros: z.array(z.string()).optional().describe('List of advantages/pros for this design'),
      cons: z.array(z.string()).optional().describe('List of disadvantages/cons for this design'),
      annotations: z.array(z.object({
        label: z.string(),
        x: z.number().describe('% from left (0-100)'),
        y: z.number().describe('% from top (0-100)')
      })).optional().describe('Callout annotations pinned to regions of the design'),
      sessionId: z.string().optional().describe('Design session ID to group this variant with'),
      order: z.number().optional().describe('Display order within the session'),
    },
    async ({ label, html, css, description, category, pros, cons, annotations, sessionId, order }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:add-to-gallery', {
        projectPath, label, html, css,
        description, category, pros, cons, annotations, sessionId, order
      })
      return { content: [{ type: 'text', text: `Added "${label}" to the gallery.` }] }
    }
  )

  server.tool(
    'canvas_design_session',
    'Start, end, select a variant in, or get status of a design session. Sessions group related design variants for comparison.',
    {
      action: z.enum(['start', 'end', 'select', 'get_status']).describe('Action to perform'),
      title: z.string().optional().describe('Session title (for "start" action)'),
      prompt: z.string().optional().describe('The original user request (for "start" action)'),
      variantId: z.string().optional().describe('Variant ID to select (for "select" action)'),
    },
    async ({ action, title, prompt, variantId }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      if (action === 'start') {
        const sessionId = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        win.webContents.send('mcp:design-session', {
          projectPath, action: 'start', sessionId, title: title || 'Design Session', prompt
        })
        return { content: [{ type: 'text', text: JSON.stringify({ sessionId, title }) }] }
      }

      if (action === 'end') {
        win.webContents.send('mcp:design-session', { projectPath, action: 'end' })
        return { content: [{ type: 'text', text: 'Design session ended.' }] }
      }

      if (action === 'select' && variantId) {
        win.webContents.send('mcp:design-session', { projectPath, action: 'select', variantId })
        return { content: [{ type: 'text', text: `Variant ${variantId} selected.` }] }
      }

      if (action === 'get_status') {
        const status = await win.webContents.executeJavaScript(`
          (function() {
            var store = window.__galleryState;
            if (!store) return JSON.stringify({ error: 'Gallery state not available' });
            return JSON.stringify(store);
          })()
        `)
        return { content: [{ type: 'text', text: status }] }
      }

      return { content: [{ type: 'text', text: 'Invalid action or missing parameters.' }] }
    }
  )

  server.tool(
    'canvas_get_selection',
    'Get which variant the user selected in the gallery. Returns the variant ID and label, or null if nothing selected.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ variantId: null }) }] }
      const selection = await win.webContents.executeJavaScript(`
        (function() {
          var store = window.__galleryState;
          if (!store || !store.selectedId) return JSON.stringify({ variantId: null });
          var variant = store.variants.find(function(v) { return v.id === store.selectedId; });
          return variant
            ? JSON.stringify({ variantId: variant.id, label: variant.label })
            : JSON.stringify({ variantId: null });
        })()
      `)
      return { content: [{ type: 'text', text: selection }] }
    }
  )

  server.tool(
    'canvas_update_variant',
    'Update an existing gallery variant\'s metadata or content.',
    {
      variantId: z.string().describe('ID of the variant to update'),
      label: z.string().optional().describe('New label'),
      html: z.string().optional().describe('New HTML content'),
      css: z.string().optional().describe('New CSS styles'),
      description: z.string().optional().describe('New description'),
      pros: z.array(z.string()).optional().describe('Updated pros list'),
      cons: z.array(z.string()).optional().describe('Updated cons list'),
      status: z.enum(['proposal', 'selected', 'rejected', 'applied']).optional().describe('New status'),
      annotations: z.array(z.object({
        label: z.string(),
        x: z.number(),
        y: z.number()
      })).optional().describe('Updated annotations'),
    },
    async ({ variantId, ...updates }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:update-variant', { projectPath, variantId, ...updates })
      return { content: [{ type: 'text', text: `Updated variant ${variantId}.` }] }
    }
  )

  server.tool(
    'canvas_checkpoint',
    'Create a git checkpoint that appears in the timeline tab.',
    {
      message: z.string().describe('Checkpoint message describing the current state')
    },
    async ({ message }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:checkpoint', { projectPath, message })
      return { content: [{ type: 'text', text: `Checkpoint created: "${message}"` }] }
    }
  )

  server.tool(
    'canvas_notify',
    'Show a notification in the status bar.',
    {
      message: z.string().describe('Notification message'),
      type: z.enum(['info', 'success', 'error']).optional().describe('Notification type. Defaults to info.')
    },
    async ({ message, type }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:notify', { projectPath, message, type: type || 'info' })
      return { content: [{ type: 'text', text: 'Notification shown.' }] }
    }
  )

  server.tool(
    'canvas_get_status',
    'Get the current state of the canvas: active tab, preview URL, dev server status, inspector status.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      const state = await win.webContents.executeJavaScript(`
        (function() {
          var cs = window.__canvasState;
          return cs ? JSON.stringify(cs) : JSON.stringify({ error: 'Canvas state not available' });
        })()
      `)
      return { content: [{ type: 'text', text: state }] }
    }
  )

  server.tool(
    'canvas_is_dev_running',
    'Check if the dev server is running. Returns "yes" or "no".',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'no' }] }
      const running = await win.webContents.executeJavaScript(`
        (function() {
          var cs = window.__canvasState;
          return cs && cs.devServerRunning ? 'yes' : 'no';
        })()
      `)
      return { content: [{ type: 'text', text: running }] }
    }
  )

  server.tool(
    'canvas_get_preview_url',
    'Get the current preview URL. Returns the URL or "none".',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'none' }] }
      const url = await win.webContents.executeJavaScript(`
        (function() {
          var cs = window.__canvasState;
          return cs && cs.previewUrl ? cs.previewUrl : 'none';
        })()
      `)
      return { content: [{ type: 'text', text: url }] }
    }
  )

  server.tool(
    'canvas_get_active_tab',
    'Get the name of the currently active canvas tab. Returns "preview", "gallery", "timeline", or "diff".',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'preview' }] }
      const tab = await win.webContents.executeJavaScript(`
        (function() {
          var cs = window.__canvasState;
          return cs && cs.activeTab ? cs.activeTab : 'preview';
        })()
      `)
      return { content: [{ type: 'text', text: tab }] }
    }
  )

  server.tool(
    'canvas_get_context',
    'Get the elements the user selected in the inspector. Returns count and elements array — each element has filePath, lineNumber, componentName, props, textContent, styles, componentChain. First element also at root level. ALWAYS call this when you see [ComponentName] tags in the message.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      const context = await win.webContents.executeJavaScript(`
        (function() {
          var ctx = window.__inspectorContext;
          return ctx ? JSON.stringify(ctx) : JSON.stringify({ selected: false });
        })()
      `)
      return { content: [{ type: 'text', text: context }] }
    }
  )

  server.tool(
    'canvas_get_screenshot',
    'Get the latest screenshot captured by the user from the canvas preview. Returns the image directly. The user captures screenshots by clicking the camera icon and dragging to select a region.',
    {},
    async () => {
      const screenshot = await getLatestScreenshotBase64()
      if (!screenshot) {
        return { content: [{ type: 'text', text: 'No screenshot available. The user has not captured one yet.' }] }
      }
      return {
        content: [
          { type: 'image', data: screenshot.data, mimeType: screenshot.mimeType },
          { type: 'text', text: 'Screenshot from the canvas preview.' }
        ]
      }
    }
  )

  server.tool(
    'canvas_get_errors',
    'Get runtime errors from the canvas preview. Returns parsed errors with message, file, line, and column. Returns "no errors" if the preview is healthy.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      const errors = await win.webContents.executeJavaScript(`
        (function() {
          var cs = window.__canvasState;
          if (!cs || !cs.errors || cs.errors.length === 0) return 'no errors';
          return JSON.stringify(cs.errors);
        })()
      `)
      return { content: [{ type: 'text', text: errors }] }
    }
  )

  server.tool(
    'canvas_get_context_minimal',
    'Get a lightweight summary of the user\'s inspector selection: only filePath, lineNumber, and componentName per element. ~30 tokens instead of ~300. Call this first; use canvas_get_context only when you need props/styles.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      const context = await win.webContents.executeJavaScript(`
        (function() {
          var ctx = window.__inspectorContext;
          if (!ctx || !ctx.elements || ctx.elements.length === 0) return JSON.stringify({ selected: false });
          return JSON.stringify({
            count: ctx.elements.length,
            elements: ctx.elements.map(function(e) {
              return { filePath: e.filePath, lineNumber: e.lineNumber, componentName: e.componentName };
            })
          });
        })()
      `)
      return { content: [{ type: 'text', text: context }] }
    }
  )

  server.tool(
    'canvas_auto_screenshot',
    'Capture a screenshot of the current canvas preview. Returns the image directly. Use this to see the current UI state without asking the user to describe it.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      try {
        // Get the canvas iframe bounding rect from the renderer
        const rect = await win.webContents.executeJavaScript(`
          (function() {
            var iframe = document.querySelector('[data-canvas-panel] iframe');
            if (!iframe) return null;
            var r = iframe.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
          })()
        `)

        if (!rect || rect.width < 1 || rect.height < 1) {
          return { content: [{ type: 'text', text: 'No canvas preview is currently visible. Start a dev server first.' }] }
        }

        const image = await win.webContents.capturePage(rect)
        const base64 = image.toPNG().toString('base64')

        return {
          content: [
            { type: 'image', data: base64, mimeType: 'image/png' },
            { type: 'text', text: `Canvas screenshot captured (${rect.width}x${rect.height}px).` }
          ]
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Screenshot failed: ${err}` }] }
      }
    }
  )

  // ─── Supabase Tools ───

  server.tool(
    'supabase_list_projects',
    'List all Supabase projects in the connected organization. Returns project names, refs, regions, and statuses.',
    {},
    async () => {
      const rawToken = getSecureToken('supabase')
      if (!rawToken) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase. Ask the user to connect via the Supabase icon in the top-right.' }] }
      }
      // Parse access token from encrypted compound token
      let sbToken: string
      try { const p = JSON.parse(rawToken) as { accessToken?: string }; sbToken = p.accessToken || rawToken } catch { sbToken = rawToken }

      try {
        const res = await fetch('https://api.supabase.com/v1/projects', {
          headers: { Authorization: `Bearer ${sbToken}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `Supabase API error (${res.status})` }] }
        const projects = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_list_tables',
    'List all tables and their columns in the linked Supabase project database. Useful for understanding the schema before writing migrations or queries.',
    {
      projectRef: z.string().optional().describe('Supabase project ref (e.g., "abcdefghijkl"). Auto-detected from supabase/config.toml if omitted.')
    },
    async ({ projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      const sql = `
        SELECT t.table_schema as schema, t.table_name as name,
          json_agg(json_build_object('name', c.column_name, 'type', c.data_type, 'nullable', c.is_nullable = 'YES') ORDER BY c.ordinal_position) as columns
        FROM information_schema.tables t
        JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_schema, t.table_name ORDER BY t.table_schema, t.table_name
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error (${res.status}): ${await res.text()}` }] }
        const rows = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_run_sql',
    'Execute a SQL query against the Supabase project database. Use for migrations (CREATE TABLE, ALTER TABLE), data queries (SELECT), inserts, updates, and RLS policy management. Returns query results as JSON.',
    {
      sql: z.string().describe('SQL query to execute'),
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ sql, projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error (${res.status}): ${await res.text()}` }] }
        const rows = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_get_schema',
    'Get the full database schema as DDL (CREATE TABLE statements). Useful before writing migrations to understand current state.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      const sql = `
        SELECT
          'CREATE TABLE ' || schemaname || '.' || tablename || ' (' ||
          string_agg(
            column_name || ' ' || data_type ||
            CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END ||
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
            ', ' ORDER BY ordinal_position
          ) || ');' as ddl
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        GROUP BY schemaname, tablename
        ORDER BY schemaname, tablename
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error: ${await res.text()}` }] }
        const rows = await res.json() as Array<{ ddl: string }>
        return { content: [{ type: 'text', text: rows.map((r) => r.ddl).join('\n\n') }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_list_functions',
    'List all Edge Functions deployed to the Supabase project.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/functions`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const fns = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(fns, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_list_buckets',
    'List all storage buckets in the Supabase project.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/storage/buckets`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const buckets = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(buckets, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_get_connection_info',
    'Get the Supabase project connection details: API URL, anon key, service role key, and database URL.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/api-keys`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const keys = await res.json() as Array<{ name: string; api_key: string }>
        const info = {
          url: `https://${auth.ref}.supabase.co`,
          anonKey: keys.find((k) => k.name === 'anon')?.api_key || '',
          serviceKey: keys.find((k) => k.name === 'service_role')?.api_key || '',
          dbUrl: `postgresql://postgres:[YOUR-PASSWORD]@db.${auth.ref}.supabase.co:5432/postgres`
        }
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  server.tool(
    'supabase_get_rls_policies',
    'List all Row Level Security (RLS) policies across all tables. Shows policy name, command (SELECT/INSERT/UPDATE/DELETE), and the policy definition.',
    {
      projectRef: z.string().optional().describe('Supabase project ref. Auto-detected if omitted.')
    },
    async ({ projectRef }) => {
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      const sql = `
        SELECT schemaname || '.' || tablename as table, policyname as name, cmd as command, qual as definition
        FROM pg_policies WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, tablename, policyname
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        })
        if (!res.ok) return { content: [{ type: 'text', text: `SQL error: ${await res.text()}` }] }
        const rows = await res.json()
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )

  // ─── Dev Server Tools ───

  server.tool(
    'configure_dev_server',
    'Configure the dev server start command for the current project. Validates the command against the allowlist (only npm/pnpm/yarn/bun/node are permitted). If valid, saves it as the preferred command and updates the Start button immediately.',
    {
      command: z.string().describe('Full command (e.g., "npm run dev", "bun dev", "pnpm start:dev")'),
      port: z.number().optional().describe('Expected dev server port (e.g., 3000, 5173)'),
      reason: z.string().optional().describe('Why this command was chosen'),
    },
    async ({ command, port, reason }) => {
      const parsed = parseCommandString(command)
      if (!parsed) {
        return { content: [{ type: 'text', text: `Invalid command: "${command}". Only npm, pnpm, yarn, bun, node, npx binaries are allowed. Shell operators (;|&><$) are forbidden.` }] }
      }

      const validation = validateCommand(parsed)
      if (!validation.ok) {
        return { content: [{ type: 'text', text: `Command rejected: ${validation.error}` }] }
      }

      setUserOverride(projectPath, parsed, port)

      // Notify renderer to update the start button
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('mcp:notify', {
          projectPath,
          message: `Dev command configured: ${command}${reason ? ` (${reason})` : ''}`,
          type: 'success',
        })
      }

      return { content: [{ type: 'text', text: `Configured: ${command}${port ? ` (port ${port})` : ''}. The Start button is now ready.` }] }
    }
  )

  server.tool(
    'analyze_dev_server',
    'Analyze the current project and return the auto-detected dev server plan. Shows what command the Start button would use, confidence level, detected framework, and whether verification is needed.',
    {},
    async () => {
      const plan = resolveDevServerPlan(projectPath)
      const summary = {
        command: commandToString(plan.command),
        cwd: plan.cwd,
        manager: plan.manager,
        port: plan.port,
        confidence: plan.confidence,
        framework: plan.detection.framework || 'unknown',
        reasons: plan.reasons,
        usedLastKnownGood: plan.detection.usedLastKnownGood || false,
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
    }
  )
}
