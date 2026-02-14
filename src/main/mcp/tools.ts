import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { getLatestScreenshotBase64 } from '../screenshot'

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
}
