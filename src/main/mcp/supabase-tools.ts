import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { getSecureToken } from '../services/secure-storage'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpTextResult } from './helpers'

type SupabaseAuth = { token: string; ref: string }

/** Linked project ref set by the renderer when the user links a Supabase project. */
let linkedProjectRef: string | null = null

/** Called from the main process when the renderer links/unlinks a Supabase project. */
export function setLinkedSupabaseRef(ref: string | null): void {
  linkedProjectRef = ref
  console.log(`[MCP/Supabase] Linked project ref: ${ref || '(none)'}`)
}

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

/** Validate Supabase token + resolve project ref, returning an error result on failure.
 *  Resolution order: explicit param > UI-linked ref > supabase/config.toml */
async function requireSupabaseAuth(
  projectPath: string,
  projectRef?: string
): Promise<SupabaseAuth | McpTextResult> {
  const token = getSecureToken('supabase')
  if (!token) {
    return { content: [{ type: 'text', text: 'Not connected to Supabase. Ask the user to connect via the Supabase icon in the top-right.' }] }
  }
  const ref = projectRef || linkedProjectRef || await detectProjectRef(projectPath)
  if (!ref) {
    return { content: [{ type: 'text', text: 'No project ref found. Pass projectRef, link a project in the Supabase icon, or ensure supabase/config.toml exists.' }] }
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

/** Format SQL results compactly to reduce terminal noise.
 *  - Write ops (empty array result): return "OK"
 *  - Small results: compact JSON (no pretty-print)
 *  - Large results: truncate with row count */
function formatResult(rows: unknown, sql?: string): string {
  if (!Array.isArray(rows)) return JSON.stringify(rows)
  // Write operations return empty array
  if (rows.length === 0) {
    const verb = sql?.trim().split(/\s+/)[0]?.toUpperCase() || 'Query'
    return `${verb} executed successfully (0 rows returned)`
  }
  // Compact JSON for small results (< 2KB)
  const compact = JSON.stringify(rows)
  if (compact.length < 2000) return compact
  // Truncate large results — show first 5 rows + count
  const preview = JSON.stringify(rows.slice(0, 5))
  return `${rows.length} rows total (showing first 5):\n${preview}`
}

export function registerSupabaseTools(
  server: McpServer,
  _getWindow: () => BrowserWindow | null,
  getProjectPath: () => string
): void {
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
        return { content: [{ type: 'text', text: formatResult(projects) }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
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
        return { content: [{ type: 'text', text: formatResult(rows) }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
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
        return { content: [{ type: 'text', text: formatResult(rows, sql) }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/functions`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const fns = await res.json()
        return { content: [{ type: 'text', text: formatResult(fns) }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
      const auth = await requireSupabaseAuth(projectPath, projectRef)
      if (isAuthError(auth)) return auth

      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${auth.ref}/storage/buckets`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
        if (!res.ok) return { content: [{ type: 'text', text: `API error (${res.status})` }] }
        const buckets = await res.json()
        return { content: [{ type: 'text', text: formatResult(buckets) }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
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
        return { content: [{ type: 'text', text: formatResult(info) }] }
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
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
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
        return { content: [{ type: 'text', text: formatResult(rows, sql) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }] }
      }
    }
  )
}
