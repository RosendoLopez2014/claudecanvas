import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { getLatestScreenshotBase64 } from '../screenshot'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

export function registerMcpTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  projectPath: string
): void {
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
      return { content: [{ type: 'text', text: 'Dev server starting. The canvas panel will open with a live preview.' }] }
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
    'Add a component variant to the gallery. Auto-opens the gallery tab.',
    {
      label: z.string().describe('Name for this variant (e.g., "Primary Button", "Dark Mode Card")'),
      html: z.string().describe('HTML content of the variant'),
      css: z.string().optional().describe('Optional CSS styles')
    },
    async ({ label, html, css }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:add-to-gallery', { projectPath, label, html, css })
      return { content: [{ type: 'text', text: `Added "${label}" to the gallery.` }] }
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase. Ask the user to connect via the Supabase icon in the top-right.' }] }
      }

      try {
        const res = await fetch('https://api.supabase.com/v1/projects', {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found. Pass projectRef or ensure supabase/config.toml exists.' }] }

      const sql = `
        SELECT t.table_schema as schema, t.table_name as name,
          json_agg(json_build_object('name', c.column_name, 'type', c.data_type, 'nullable', c.is_nullable = 'YES') ORDER BY c.ordinal_position) as columns
        FROM information_schema.tables t
        JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_schema, t.table_name ORDER BY t.table_schema, t.table_name
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

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
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/storage/buckets`, {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
          headers: { Authorization: `Bearer ${tokens.supabase}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const keys = await res.json() as Array<{ name: string; api_key: string }>
        const info = {
          url: `https://${ref}.supabase.co`,
          anonKey: keys.find((k) => k.name === 'anon')?.api_key || '',
          serviceKey: keys.find((k) => k.name === 'service_role')?.api_key || '',
          dbUrl: `postgresql://postgres:[YOUR-PASSWORD]@db.${ref}.supabase.co:5432/postgres`
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
      const { settingsStore } = await import('../store')
      const tokens = settingsStore.get('oauthTokens') || {}
      if (!tokens.supabase) {
        return { content: [{ type: 'text', text: 'Not connected to Supabase.' }] }
      }

      const ref = projectRef || await detectProjectRef(projectPath)
      if (!ref) return { content: [{ type: 'text', text: 'No project ref found.' }] }

      const sql = `
        SELECT schemaname || '.' || tablename as table, policyname as name, cmd as command, qual as definition
        FROM pg_policies WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, tablename, policyname
      `
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.supabase}`, 'Content-Type': 'application/json' },
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
}
