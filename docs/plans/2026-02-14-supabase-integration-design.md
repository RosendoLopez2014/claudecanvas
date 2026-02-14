# Supabase Integration — Design Document

**Date:** 2026-02-14
**Status:** Approved

## Summary

Upgrade the minimal Supabase integration (external browser auth, no features) to a full-featured integration matching the Vercel and GitHub patterns. Two integration surfaces:

1. **UI layer** — Rich ServiceIcons dropdown with project management, table listing, edge functions, storage, RLS policies, and connection info
2. **Claude Code layer** — MCP tools for SQL execution, schema introspection, and project queries + CLI token injection

## Current State (Gap Analysis)

| Feature | GitHub | Vercel | Supabase (current) |
|---------|--------|--------|---------------------|
| Auth flow | WebContentsView (Device) | WebContentsView (AuthCode) | External browser |
| User profile | login, avatar | username, name, avatar | None |
| Cancel/updateBounds | Yes | Yes | No |
| Service-specific APIs | repos, PRs | projects, deployments, logs | None |
| CLI token injection | GH_TOKEN | VERCEL_TOKEN | No |
| MCP tools | N/A | N/A | N/A |
| Dropdown UI | User + repo management | User + project + deployments | Connect/disconnect only |

## Design

### 1. OAuth Flow

**Pattern:** Authorization Code with embedded WebContentsView (matching Vercel exactly)

- Local HTTP callback server on port **38903** (already reserved in current code)
- CSRF protection via `crypto.randomBytes` state parameter
- WebContentsView positioned in canvas panel with bounds tracking
- SSO popup allowlist: `accounts.google.com`, `appleid.apple.com`, `github.com/login`
- Escape-to-cancel via `before-input-event` listener
- 10-minute timeout with auto-cleanup

**Token exchange:**
```
POST https://api.supabase.com/v1/oauth/token
{
  grant_type: "authorization_code",
  code: <from callback>,
  client_id: <env>,
  client_secret: <env>,
  redirect_uri: "http://localhost:38903"
}
```

**On success:**
1. Store `oauthTokens.supabase` (access token)
2. Fetch user profile: `GET /v1/profile` → store as `supabaseUser`
3. Fetch organizations: `GET /v1/organizations` → store primary org as `supabaseAuth.orgId`

### 2. Storage Schema

```typescript
interface SettingsSchema {
  oauthTokens: {
    github?: string
    vercel?: string
    supabase?: string
  }
  githubUser?: { login: string; avatar_url: string }
  vercelUser?: { username: string; name: string | null; avatar: string | null }
  supabaseUser?: { id: string; name: string; email: string; avatar_url: string | null }
  supabaseAuth?: { orgId: string }
}
```

### 3. IPC Handlers (Main Process)

All registered in `src/main/oauth/supabase.ts`:

| Handler | Args | Returns |
|---------|------|---------|
| `oauth:supabase:start` | `{ bounds }` | `{ token } \| { error }` |
| `oauth:supabase:cancel` | — | `{ cancelled: true }` |
| `oauth:supabase:updateBounds` | `{ x, y, w, h }` | void (send) |
| `oauth:supabase:status` | — | `{ connected, name?, email?, avatar_url? }` |
| `oauth:supabase:logout` | — | void |
| `oauth:supabase:listProjects` | — | `Project[] \| { error }` |
| `oauth:supabase:projectDetails` | `projectRef` | `ProjectDetails \| { error }` |
| `oauth:supabase:listTables` | `projectRef` | `Table[] \| { error }` |
| `oauth:supabase:listFunctions` | `projectRef` | `Function[] \| { error }` |
| `oauth:supabase:listBuckets` | `projectRef` | `Bucket[] \| { error }` |
| `oauth:supabase:listPolicies` | `projectRef` | `Policy[] \| { error }` |
| `oauth:supabase:runSql` | `projectRef, sql` | `QueryResult \| { error }` |
| `oauth:supabase:getConnectionInfo` | `projectRef` | `ConnectionInfo \| { error }` |

**API helper:**
```typescript
function supabaseApi(path: string): string {
  return `https://api.supabase.com/v1${path}`
}
```

All API calls use `Authorization: Bearer <token>` header.

### 4. Preload Bridge

Expand `oauth.supabase` in `src/preload/index.ts` to expose all 13 handlers above via `ipcRenderer.invoke` (async) and `ipcRenderer.send` (fire-and-forget for updateBounds).

### 5. PTY Token Injection

In `src/main/pty.ts`, add:
```typescript
if (tokens.supabase) env.SUPABASE_ACCESS_TOKEN = tokens.supabase
```

This allows the `supabase` CLI to use the Canvas-authenticated account automatically.

### 6. ServiceIcons Dropdown UI

Follows the Vercel dropdown pattern exactly:

**Header section:**
- User avatar (or initials fallback) + email
- Organization name

**Linked project section** (auto-detected):
- Project name + region
- Status indicator (active/paused/unhealthy)
- Connection string with copy button
- "Open Dashboard" link

**Collapsible sections:**
- **Tables:** Schema-grouped table names with column count
- **Edge Functions:** Function names with status
- **Storage Buckets:** Bucket names with public/private indicator
- **RLS Policies:** Count per table

**Footer:**
- "Open Dashboard" button → external browser
- "Disconnect" button

**Project detection strategy:**
1. Check for `supabase/config.toml` in project root (Supabase CLI project)
2. Match project folder name against Supabase project names
3. If no match: show searchable project list (like Vercel's project picker)

### 7. MCP Tools for Claude Code

Registered in `src/main/mcp/tools.ts`, auto-approved in config-writer:

| Tool | Description | Parameters |
|------|-------------|------------|
| `supabase_list_projects` | List all Supabase projects | — |
| `supabase_list_tables` | List tables + columns | `projectRef?` (auto-detect from linked) |
| `supabase_run_sql` | Execute SQL query | `sql`, `projectRef?` |
| `supabase_get_schema` | Full DDL dump | `projectRef?` |
| `supabase_list_functions` | List edge functions | `projectRef?` |
| `supabase_list_buckets` | List storage buckets | `projectRef?` |
| `supabase_get_connection_info` | Connection string, API keys | `projectRef?` |
| `supabase_get_rls_policies` | RLS policies per table | `projectRef?` |

**Auto-detection:** When `projectRef` is omitted, tools check `supabase/config.toml` in the current project directory for the linked project reference.

**CLAUDE.md additions:** Instructions for Claude Code on when/how to use Supabase tools (migration workflow, schema verification, RLS patterns).

### 8. State Exposure

Add to `window.__canvasState` (via `useMcpStateExposer.ts`):
```typescript
{
  // ...existing fields
  supabaseProject: string | null,  // linked project ref
  supabaseConnected: boolean
}
```

## Files Modified

| File | Change |
|------|--------|
| `src/main/oauth/supabase.ts` | Rewrite: WebContentsView flow, all API handlers |
| `src/main/store.ts` | Add `supabaseUser`, `supabaseAuth` |
| `src/main/pty.ts` | Add `SUPABASE_ACCESS_TOKEN` injection |
| `src/main/mcp/tools.ts` | Add 8 Supabase MCP tools |
| `src/main/mcp/config-writer.ts` | Auto-approve tools, CLAUDE.md instructions |
| `src/preload/index.ts` | Expand `oauth.supabase` bridge |
| `src/renderer/components/ServiceIcons/ServiceIcons.tsx` | Full dropdown UI |
| `src/renderer/hooks/useMcpStateExposer.ts` | Expose Supabase state |

## Files Created

None — all changes fit in existing files.

## API Reference

- **Supabase Management API v1:** `https://api.supabase.com/v1/`
  - `GET /v1/profile` — user profile
  - `GET /v1/organizations` — list orgs
  - `GET /v1/projects` — list projects
  - `GET /v1/projects/{ref}` — project details
  - `POST /v1/projects/{ref}/database/query` — execute SQL
  - `GET /v1/projects/{ref}/functions` — edge functions
  - `GET /v1/projects/{ref}/storage/buckets` — storage buckets
  - `GET /v1/projects/{ref}/api-keys` — API keys

## Security

- Context isolation ON for WebContentsView (no nodeIntegration)
- CSRF state parameter for OAuth callback
- Token stored in electron-store (same security as GitHub/Vercel tokens)
- SQL execution scoped to authenticated project (no cross-project access)
- MCP tools auto-approved only for the canvas MCP server (not arbitrary servers)
