import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { getLatestScreenshotBase64 } from '../screenshot'
import { generateProjectProfile } from '../services/project-profile'
import { executeWithTimeout, errorResponse } from './helpers'

export function registerCanvasTools(
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
      componentPath: z.string().optional().describe(
        'Source file path relative to project root (e.g., "src/components/Button.tsx"). ' +
        'When set and the dev server is running, the gallery renders the actual component ' +
        'live with HMR instead of the static HTML.'
      ),
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
    async ({ label, html, css, componentPath, description, category, pros, cons, annotations, sessionId, order }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      win.webContents.send('mcp:add-to-gallery', {
        projectPath, label, html, css, componentPath,
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
        try {
          const status = await executeWithTimeout<string>(win, `
            (function() {
              var store = window.__galleryState;
              if (!store) return JSON.stringify({ error: 'Gallery state not available' });
              return JSON.stringify(store);
            })()
          `)
          return { content: [{ type: 'text', text: status }] }
        } catch (err) {
          return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
        }
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
      try {
        const selection = await executeWithTimeout<string>(win, `
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
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
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
      try {
        const state = await executeWithTimeout<string>(win, `
          (function() {
            var cs = window.__canvasState;
            return cs ? JSON.stringify(cs) : JSON.stringify({ error: 'Canvas state not available' });
          })()
        `)
        return { content: [{ type: 'text', text: state }] }
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
    }
  )

  server.tool(
    'canvas_is_dev_running',
    'Check if the dev server is running. Returns "yes" or "no".',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'no' }] }
      try {
        const running = await executeWithTimeout<string>(win, `
          (function() {
            var cs = window.__canvasState;
            return cs && cs.devServerRunning ? 'yes' : 'no';
          })()
        `)
        return { content: [{ type: 'text', text: running }] }
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
    }
  )

  server.tool(
    'canvas_get_preview_url',
    'Get the current preview URL. Returns the URL or "none".',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'none' }] }
      try {
        const url = await executeWithTimeout<string>(win, `
          (function() {
            var cs = window.__canvasState;
            return cs && cs.previewUrl ? cs.previewUrl : 'none';
          })()
        `)
        return { content: [{ type: 'text', text: url }] }
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
    }
  )

  server.tool(
    'canvas_get_active_tab',
    'Get the name of the currently active canvas tab. Returns "preview", "gallery", "timeline", or "diff".',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'preview' }] }
      try {
        const tab = await executeWithTimeout<string>(win, `
          (function() {
            var cs = window.__canvasState;
            return cs && cs.activeTab ? cs.activeTab : 'preview';
          })()
        `)
        return { content: [{ type: 'text', text: tab }] }
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
    }
  )

  server.tool(
    'canvas_get_context',
    'Get the elements the user selected in the inspector. Returns count and elements array — each element has filePath, lineNumber, componentName, props, textContent, styles, componentChain. First element also at root level. ALWAYS call this when you see [ComponentName] tags in the message.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      try {
        const context = await executeWithTimeout<string>(win, `
          (function() {
            var ctx = window.__inspectorContext;
            return ctx ? JSON.stringify(ctx) : JSON.stringify({ selected: false });
          })()
        `)
        // Signal editing mode — switches cyan highlights to amber glow
        try {
          const parsed = JSON.parse(context)
          if (parsed.selected) {
            await executeWithTimeout(win, `
              (function() {
                var iframe = document.querySelector('[data-canvas-panel] iframe');
                if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'inspector:startEditing' }, '*');
              })()
            `)
          }
        } catch {}
        return { content: [{ type: 'text', text: context }] }
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
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
    'Get runtime errors from the canvas preview and CLEAR them. Returns parsed errors with message, file, line, and column. Returns "no errors" if the preview is healthy. Errors are cleared after reading — call again after fixing to check for NEW errors only.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      try {
        const errors = await executeWithTimeout<string>(win, `
          (function() {
            var cs = window.__canvasState;
            if (!cs || !cs.errors || cs.errors.length === 0) return 'no errors';
            var result = JSON.stringify(cs.errors);
            // Clear after reading so next call only shows NEW errors
            cs.errors = [];
            return result;
          })()
        `)
        return { content: [{ type: 'text', text: errors }] }
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
    }
  )

  server.tool(
    'canvas_get_context_minimal',
    'Get a lightweight summary of the user\'s inspector selection: only filePath, lineNumber, and componentName per element. ~30 tokens instead of ~300. Call this first; use canvas_get_context only when you need props/styles.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
      try {
        const context = await executeWithTimeout<string>(win, `
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
      } catch (err) {
        return errorResponse(`Failed to query renderer: ${(err as Error).message}`)
      }
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
        const rect = await executeWithTimeout<{ x: number; y: number; width: number; height: number } | null>(win, `
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
}
