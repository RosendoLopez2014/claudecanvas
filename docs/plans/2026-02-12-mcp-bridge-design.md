# Claude Canvas MCP Bridge Design

## Problem

Claude Code runs as a CLI process inside the Canvas terminal (PTY). It has no way to:
- Render components visually in the canvas panel
- Control canvas tabs (preview, gallery, timeline, diff)
- Know when the user interacts with the inspector
- Auto-open live previews when building visual projects

## Solution

Claude Canvas runs a local **MCP server over HTTP** inside the Electron main process. When a project opens, Canvas writes a `.mcp.json` to the project directory. Claude Code auto-discovers it and gains structured tools for full bidirectional communication.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Claude Canvas                    │
│                                                   │
│  ┌─────────────┐   HTTP    ┌───────────────────┐ │
│  │  MCP Server  │◄────────►│  Claude Code (PTY) │ │
│  │  :dynamic    │  tools   │                    │ │
│  └──────┬───────┘          └─────────▲──────────┘ │
│         │ IPC events               │ pty.write()  │
│  ┌──────▼──────────────────────────┐│             │
│  │  Renderer (React / Zustand)     ││             │
│  │  Canvas | Gallery | Terminal    │┘             │
│  └─────────────────────────────────┘              │
└──────────────────────────────────────────────────┘
```

### Why HTTP transport (not stdio)?

Claude Code is spawned as a PTY process — we don't control its stdin/stdout for MCP wire protocol. An HTTP server on a dynamic local port lets Claude Code connect via URL without interfering with the terminal I/O.

### Discovery

When a project opens in the workspace:
1. Electron main process starts an HTTP MCP server on a dynamic port
2. Writes `.mcp.json` to the project root:
   ```json
   {
     "mcpServers": {
       "claude-canvas": {
         "type": "http",
         "url": "http://localhost:{PORT}/mcp"
       }
     }
   }
   ```
3. Claude Code, launched in that project directory, auto-discovers the server
4. On project close or app quit, `.mcp.json` is cleaned up

### .mcp.json lifecycle
- Created when entering workspace screen with a project
- Deleted on: project switch, app quit, window close
- Added to `.gitignore` to prevent accidental commits (the port changes every session)

## MCP Tools

### Claude Code → Canvas (9 tools)

| Tool | Parameters | Effect |
|------|-----------|--------|
| `canvas_render` | `html`, `css?` | Measure dimensions via render router. Small → inline xterm decoration. Large → auto-open canvas panel and render in iframe. |
| `canvas_start_preview` | `command?`, `cwd?` | Start dev server (auto-detect framework command if not provided), detect port, auto-open canvas panel with `localhost:{port}` URL. |
| `canvas_stop_preview` | — | Kill dev server, close canvas panel. |
| `canvas_set_preview_url` | `url` | Point the canvas preview iframe at a specific URL. Auto-opens canvas. |
| `canvas_open_tab` | `tab: preview\|gallery\|timeline\|diff` | Switch canvas to specified tab. Auto-opens canvas if closed. |
| `canvas_add_to_gallery` | `label`, `html`, `css?` | Add a component variant to the gallery grid. Auto-opens gallery tab. |
| `canvas_checkpoint` | `message` | Create git checkpoint. Appears in timeline tab. |
| `canvas_notify` | `message`, `type?: info\|success\|error` | Show a toast notification in the status bar. |
| `canvas_get_status` | — | Return current canvas state: active tab, preview URL, dev server running, inspector active. |

### Canvas → Claude Code (2 mechanisms)

| Mechanism | Trigger | What happens |
|-----------|---------|-------------|
| **Inspector paste** | User clicks element in canvas preview | Inspector extracts component name, source file, line number, and key styles. Writes formatted context string to PTY stdin so it appears as if the user typed it into Claude. |
| **`canvas_get_context` tool** | Claude calls it | Returns current inspector selection (if any), active tab, preview URL, selected gallery variant. Claude can poll this to understand what the user is looking at. |

## Auto-Preview Behavior

The core UX innovation: **any visual action automatically opens the canvas**.

### Flow: Building a React app
1. Claude scaffolds project files
2. Claude calls `canvas_start_preview` → dev server starts, canvas auto-opens with `localhost:3000`
3. Claude writes/modifies components → dev server HMR pushes updates → iframe reflects changes live
4. Claude calls `canvas_add_to_gallery` to save interesting variants
5. User clicks element in preview → inspector context auto-pastes into Claude's terminal
6. Claude calls `canvas_checkpoint` → snapshot appears in timeline

### Flow: One-shot render (no dev server)
1. Claude calls `canvas_render` with HTML/CSS
2. Render router measures dimensions in hidden BrowserWindow
3. If small (< 400x200px): rendered inline in terminal via xterm decoration
4. If large: canvas panel auto-opens, HTML rendered in sandboxed iframe

### Flow: User inspects and asks for changes
1. User enables inspector (Cmd+I or status bar toggle)
2. User clicks a button in the live preview
3. Inspector extracts: `<Button> in src/components/Button.tsx:42` with key styles
4. Context is pasted into terminal: `[Inspector] Button (src/components/Button.tsx:42) — flex, bg-blue-500, px-4 py-2, rounded-md`
5. Claude reads this and can modify the component with full context

## Implementation Considerations

### MCP Server in Electron
- Use `@modelcontextprotocol/sdk` (official MCP TypeScript SDK) to build the server
- HTTP transport via the SDK's built-in Streamable HTTP support
- Server runs in the Electron main process (has access to all IPC, stores, services)
- Dynamic port allocation via `detect-port` (already a dependency)

### State Bridge: MCP Server ↔ Renderer
The MCP server runs in main process but needs to control renderer state (Zustand stores). Communication path:
```
MCP tool called → main process handler → IPC send to renderer → Zustand store update → React re-render
```
And reverse for context queries:
```
Claude calls canvas_get_context → main process → IPC invoke to renderer → read Zustand state → return
```

### PTY Paste for Inspector
When the inspector sends context back to Claude:
```
Inspector click → postMessage to parent → renderer receives → pty.write(contextString + '\n')
```
This effectively types the context into Claude Code's input buffer.

### Cleanup
- `.mcp.json` must be removed on app exit (including crashes — use `process.on('exit')` and `app.on('before-quit')`)
- Server port must be released
- Consider writing a `.mcp.json.lock` or using a temp file that Claude Code can detect as stale

### Security
- MCP server binds to `127.0.0.1` only (no network exposure)
- No authentication needed for localhost-only server
- `.mcp.json` added to `.gitignore` automatically
