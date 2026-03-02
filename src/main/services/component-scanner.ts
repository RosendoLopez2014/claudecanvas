import { ipcMain } from 'electron'
import { readdir, readFile, writeFile, unlink, access } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { join, relative, extname, basename } from 'path'
import { isValidPath } from '../validate'

interface ScannedComponent {
  name: string
  filePath: string
  relativePath: string
}

export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt', '.output',
  '.cache', '.turbo', '.vercel', '.svelte-kit', 'build',
  'coverage', '__pycache__'
])

export const IGNORE_PATTERNS = ['.test.', '.spec.', '.stories.']

export const COMPONENT_EXTENSIONS = new Set(['.tsx', '.jsx', '.vue', '.svelte'])

export const MAX_DEPTH = 5

/**
 * Regex patterns to detect default exports.
 * Matches:
 *   export default function ComponentName
 *   export default class ComponentName
 *   export default ComponentName
 */
const DEFAULT_EXPORT_PATTERNS = [
  /export\s+default\s+function\s+(\w+)/,
  /export\s+default\s+class\s+(\w+)/,
  /export\s+default\s+(\w+)/,
]

/**
 * Attempt to extract the default-exported component name from file contents.
 * Returns null if no default export is detected.
 * For Vue SFCs, looks for `name:` in script block.
 * For Svelte, returns null (always uses filename).
 */
export function parseComponentName(content: string, ext?: string): string | null {
  // Vue SFC — look for name property in <script> block
  if (ext === '.vue') {
    const nameMatch = content.match(/name:\s*['"](\w+)['"]/)
    return nameMatch?.[1] || null
  }
  // Svelte — always use filename (no reliable name extraction)
  if (ext === '.svelte') return null

  // React/JSX — look for default export patterns
  for (const pattern of DEFAULT_EXPORT_PATTERNS) {
    const match = content.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }
  return null
}

/**
 * Convert a filename to a PascalCase component name.
 * e.g. "my-button.tsx" -> "MyButton"
 */
export function fileNameToComponentName(fileName: string): string {
  const base = basename(fileName).replace(/\.(tsx|jsx|vue|svelte)$/, '')
  return base
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

async function scanDirectory(
  dirPath: string,
  projectPath: string,
  results: ScannedComponent[],
  depth: number
): Promise<void> {
  if (depth > MAX_DEPTH) return

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      await scanDirectory(fullPath, projectPath, results, depth + 1)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (!COMPONENT_EXTENSIONS.has(ext)) continue

      // Skip test/spec/stories files
      if (IGNORE_PATTERNS.some((p) => entry.name.includes(p))) continue

      // Skip index files — they're typically re-exports, not components
      if (entry.name === 'index.tsx' || entry.name === 'index.jsx') continue

      try {
        const content = await readFile(fullPath, 'utf-8')
        const parsedName = parseComponentName(content, ext)
        // Fall back to PascalCase from filename if regex doesn't match
        const name = parsedName || fileNameToComponentName(entry.name)

        results.push({
          name,
          filePath: fullPath,
          relativePath: relative(projectPath, fullPath),
        })
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export function setupComponentScannerHandlers(): void {
  // component:scan — discover components in src/components/**/*.tsx|jsx
  ipcMain.handle('component:scan', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return []

    const componentsDir = join(projectPath, 'src', 'components')
    const results: ScannedComponent[] = []

    await scanDirectory(componentsDir, projectPath, results, 0)

    return results
  })

  // component:parse — generate a minimal render template for a component
  ipcMain.handle(
    'component:parse',
    async (_event, filePath: string, projectPath: string) => {
      if (!isValidPath(filePath) || !isValidPath(projectPath)) return null

      const relPath = relative(projectPath, filePath)

      // Read the file to get the component name
      let name: string
      try {
        const content = await readFile(filePath, 'utf-8')
        const ext = extname(filePath).toLowerCase()
        name = parseComponentName(content, ext) || fileNameToComponentName(basename(filePath))
      } catch {
        name = fileNameToComponentName(basename(filePath))
      }

      // Return a best-effort render template
      // This won't work without a bundler, but provides a placeholder for the gallery
      const html = [
        '<div id="root"></div>',
        '<script type="module">',
        `  import Component from './${relPath}';`,
        `  import { createRoot } from 'react-dom/client';`,
        `  import React from 'react';`,
        `  createRoot(document.getElementById('root')).render(React.createElement(Component));`,
        '</script>',
      ].join('\n')

      return { name, html, relativePath: relPath }
    }
  )

  const PREVIEW_FILENAME = '__canvas_preview.html'

  // ─── Framework-specific mount code generators ──────────────────────
  // Only the mount function changes per framework. Everything else
  // (postMessage, error capture, HMR) is shared.

  const MOUNT_REACT = `
let cleanup = null;
async function mount(Component) {
  const React = await import('react');
  const ReactDOM = await import('react-dom/client');
  const container = document.getElementById('root');
  class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { POST('error', { message: error.message }); }
    render() {
      if (this.state.error) return React.createElement('div', { className: 'preview-error' }, this.state.error.message);
      return this.props.children;
    }
  }
  const root = ReactDOM.createRoot(container);
  root.render(React.createElement(ErrorBoundary, null, React.createElement(Component)));
  cleanup = () => root.unmount();
}`

  const MOUNT_VUE = `
let cleanup = null;
async function mount(component) {
  const { createApp } = await import('vue');
  const container = document.getElementById('root');
  container.innerHTML = '';
  const app = createApp(component);
  app.config.errorHandler = (err) => POST('error', { message: String(err) });
  app.mount(container);
  cleanup = () => app.unmount();
}`

  const MOUNT_SVELTE = `
let cleanup = null;
function mount(Component) {
  const container = document.getElementById('root');
  container.innerHTML = '';
  const instance = new Component({ target: container });
  cleanup = () => instance.$destroy();
}`

  /**
   * Detect the UI framework by reading package.json dependencies directly.
   * More reliable than framework-detect.ts for UI library detection since
   * a "vite" project could be React, Vue, or Svelte.
   */
  function resolveUIFramework(projectPath: string): 'react' | 'vue' | 'svelte' {
    try {
      const pkgPath = join(projectPath, 'package.json')
      if (!existsSync(pkgPath)) return 'react'
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if ('vue' in allDeps) return 'vue'
      if ('svelte' in allDeps || '@sveltejs/kit' in allDeps) return 'svelte'
    } catch { /* fall through */ }
    return 'react'
  }

  /**
   * Extract <link> and <style> tags from the project's index.html <head>.
   * This ensures the harness has the same fonts, preconnects, icon sets,
   * and theme CSS as the real app — not just the CSS entry point.
   */
  /** Parse a hex color and return its perceived luminance (0–1). */
  function hexLuminance(hex: string): number {
    const h = hex.replace('#', '')
    if (h.length < 6) return 0.5
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    return 0.299 * r + 0.587 * g + 0.114 * b
  }

  function resolveHeadResources(projectPath: string): { headTags: string; cssImport: string; htmlAttrs: string; bodyAttrs: string; bgColor: string; textColor: string } {
    let headTags = ''
    let cssImport = ''
    let htmlAttrs = ''
    let bodyAttrs = ''
    let bgColor = ''
    let textColor = ''

    // 1. Extract <link> tags, <html>/<body> attributes, and background from index.html
    const indexPath = join(projectPath, 'index.html')
    if (existsSync(indexPath)) {
      try {
        const html = readFileSync(indexPath, 'utf-8')

        // Extract <html ...> attributes (class="dark", data-theme, lang, etc.)
        const htmlTagMatch = html.match(/<html\s([^>]*)>/i)
        if (htmlTagMatch) htmlAttrs = htmlTagMatch[1]

        // Extract <body ...> attributes (class, style, etc.)
        const bodyTagMatch = html.match(/<body\s([^>]*)>/i)
        if (bodyTagMatch) bodyAttrs = bodyTagMatch[1]

        const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
        if (headMatch) {
          const head = headMatch[1]
          // Extract link tags (stylesheets, preconnects, dns-prefetch, icons)
          const linkTags = head.match(/<link\s[^>]*>/gi) || []
          for (const tag of linkTags) {
            // Skip favicon and module preloads — only keep stylesheets and preconnects
            if (/rel=["'](?:stylesheet|preconnect|dns-prefetch)["']/i.test(tag)) {
              headTags += tag + '\n'
            }
            // Also keep crossorigin link tags (like gstatic preconnect)
            else if (/crossorigin/i.test(tag) && /preconnect|dns-prefetch/i.test(tag)) {
              headTags += tag + '\n'
            }
          }
          // Extract inline <style> tags (theme variables, etc.)
          const styleTags = head.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []
          for (const tag of styleTags) {
            headTags += tag + '\n'
          }
        }
      } catch { /* skip unreadable */ }
    }

    // 2. Detect page background color from CSS (for theme-correct preview)
    // Check CSS variables or body background in the main stylesheet
    const cssPaths = [
      'src/index.css', 'src/globals.css', 'src/styles/globals.css',
      'src/App.css', 'src/style.css', 'src/styles.css',
    ]
    for (const cssPath of cssPaths) {
      const fullPath = join(projectPath, cssPath)
      if (!existsSync(fullPath)) continue
      try {
        const css = readFileSync(fullPath, 'utf-8')
        // Look for --color-surface or --bg- CSS variable (common dark theme pattern)
        const surfaceMatch = css.match(/--color-surface:\s*([^;]+)/i)
        if (surfaceMatch) { bgColor = surfaceMatch[1].trim() }
        // Look for body background
        if (!bgColor) {
          const bodyBgMatch = css.match(/body\s*\{[^}]*background(?:-color)?:\s*([^;}\n]+)/i)
          if (bodyBgMatch) { bgColor = bodyBgMatch[1].trim() }
        }
        // Look for a light text color variable (chalk, text, foreground)
        const chalkMatch = css.match(/--color-(?:chalk|text|foreground):\s*([^;]+)/i)
        if (chalkMatch) { textColor = chalkMatch[1].trim() }
        if (bgColor) break
      } catch { /* skip */ }
    }

    // If we found a dark background but no explicit text color, infer white text
    if (bgColor && bgColor.startsWith('#') && !textColor) {
      if (hexLuminance(bgColor) < 0.4) textColor = '#ffffff'
    }

    // 2. Find the main CSS entry point for Vite import
    const cssCandidates = [
      'src/index.css', 'src/globals.css', 'src/styles/globals.css',
      'src/App.css', 'src/style.css', 'src/styles.css',
    ]
    for (const candidate of cssCandidates) {
      if (existsSync(join(projectPath, candidate))) {
        cssImport = `import '/${candidate}';`
        break
      }
    }
    if (!cssImport) {
      // Parse main entry file for CSS imports
      const entries = ['src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts', 'src/main.jsx', 'src/index.jsx']
      for (const entry of entries) {
        if (!existsSync(join(projectPath, entry))) continue
        try {
          const content = readFileSync(join(projectPath, entry), 'utf-8')
          const match = content.match(/import\s+['"](\.\/?[^'"]+\.css)['"]/m)
          if (match) {
            const cssPath = match[1]
            const dir = entry.substring(0, entry.lastIndexOf('/'))
            const resolved = cssPath.startsWith('./')
              ? join(dir, cssPath.slice(2)).replace(/\\/g, '/')
              : cssPath.startsWith('../')
                ? join(dir, cssPath).replace(/\\/g, '/')
                : cssPath
            cssImport = `import '/${resolved}';`
            break
          }
        } catch { /* skip */ }
      }
    }

    return { headTags, cssImport, htmlAttrs, bodyAttrs, bgColor, textColor }
  }

  /** Build the preview HTML harness for a specific UI framework.
   *
   * Structure:
   *   <body>
   *     <div id="stage">       ← bleed padding lives here (shadows/glows)
   *       <div id="root"></div> ← component mount point (no extra padding)
   *       <div id="portal"></div> ← for popovers/modals/tooltips
   *     </div>
   *   </body>
   *
   * Supports 3 preview modes (set via ?mode= query param or CANVAS_SET_MODE message):
   *   intrinsic — #root is display:inline-block, content drives size
   *   viewport  — #root is width:100% inside a fixed-width #stage (default 900px, via ?vw=)
   *   fill      — #root is 100%×100%, parent controls iframe size
   */
  function buildPreviewHtml(
    framework: 'react' | 'vue' | 'svelte',
    resources: { headTags: string; cssImport: string; htmlAttrs: string; bodyAttrs: string; bgColor: string; textColor: string }
  ): string {
    const mountCode = framework === 'vue' ? MOUNT_VUE
      : framework === 'svelte' ? MOUNT_SVELTE
      : MOUNT_REACT

    const bg = resources.bgColor || 'transparent'
    const fg = resources.textColor ? `color: ${resources.textColor};` : ''

    return `<!DOCTYPE html>
<html ${resources.htmlAttrs}>
<head>
${resources.headTags}<style>
  html, body { margin: 0; padding: 0; background: ${bg}; ${fg} overflow: visible; }
  #stage { overflow: visible; position: relative; }
  #root { margin: 0; overflow: visible; }
  #portal { position: absolute; top: 0; left: 0; width: 100%; height: 0; overflow: visible; z-index: 9999; }

  /* Mode: intrinsic — content drives size */
  body.mode-intrinsic #stage { display: inline-block; }
  body.mode-intrinsic #root { display: inline-block; }

  /* Mode: viewport — fixed-width container, height from content */
  body.mode-viewport #stage { display: block; }
  body.mode-viewport #root { width: 100%; }

  /* Mode: fill — parent controls both dimensions */
  body.mode-fill { width: 100%; height: 100%; overflow: hidden; }
  body.mode-fill #stage { width: 100%; height: 100%; }
  body.mode-fill #root { width: 100%; height: 100%; }

  .preview-loading {
    display: flex; align-items: center; justify-content: center;
    gap: 8px; color: #888; font-size: 13px; padding: 24px;
  }
  .preview-loading::before {
    content: ''; width: 14px; height: 14px;
    border: 2px solid #ddd; border-top-color: #4AEAFF;
    border-radius: 50%; animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .preview-error { color: #ff6b4a; font-size: 13px; padding: 16px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div id="stage">
  <div id="root"><p class="preview-loading">Loading component\u2026</p></div>
  <div id="portal"></div>
</div>
<script type="module">
${resources.cssImport}

// ─── Messaging ────────────────────────────────────────────
function POST(type, data) {
  try { window.parent.postMessage({ type: 'canvas:' + type, ...data }, '*'); } catch {}
}

// ─── Mode management ──────────────────────────────────────
const BLEED = 32; // px of padding on #stage for shadows/glows
const params = new URLSearchParams(location.search);
let currentMode = params.get('mode') || 'viewport';
let viewportWidth = parseInt(params.get('vw') || '900', 10);

function applyMode(mode, vw) {
  currentMode = mode || currentMode;
  if (vw) viewportWidth = vw;
  const body = document.body;
  body.classList.remove('mode-intrinsic', 'mode-viewport', 'mode-fill');
  body.classList.add('mode-' + currentMode);
  const stage = document.getElementById('stage');
  stage.style.padding = BLEED + 'px';
  if (currentMode === 'viewport') {
    stage.style.width = viewportWidth + 'px';
  } else if (currentMode === 'intrinsic') {
    stage.style.width = '';
  } else if (currentMode === 'fill') {
    stage.style.width = '100%';
    stage.style.height = '100%';
    stage.style.padding = '0';
  }
  // Re-measure after mode change
  requestAnimationFrame(reportSize);
}

// ─── Sizing ───────────────────────────────────────────────
let fontsReady = false;
let lastW = 0, lastH = 0, lastCW = 0, lastCH = 0;
function reportSize() {
  if (currentMode === 'fill') return; // parent controls size in fill mode
  const stage = document.getElementById('stage');
  const root = document.getElementById('root');
  if (!stage || !root) return;
  const stageRect = stage.getBoundingClientRect();
  const w = Math.ceil(stageRect.width);
  const h = Math.ceil(stageRect.height);
  // Measure actual rendered content size using a Range around root's children.
  // In viewport mode, #root is width:100% so getBoundingClientRect() = 900px.
  // But Range gives us the tight bounding box of the actual pixels.
  let contentW = 0, contentH = 0;
  if (root.firstChild) {
    const range = document.createRange();
    range.selectNodeContents(root);
    const cr = range.getBoundingClientRect();
    contentW = Math.ceil(cr.width);
    contentH = Math.ceil(cr.height);
  }
  // Post when ANY dimension changes — not just stage dims.
  // Content dims change independently (e.g. async React render while stage stays 964px).
  if (w !== lastW || h !== lastH || contentW !== lastCW || contentH !== lastCH) {
    lastW = w; lastH = h; lastCW = contentW; lastCH = contentH;
    POST('size', { width: w, height: h, contentWidth: contentW, contentHeight: contentH });
  }
}
document.fonts.ready.then(() => { fontsReady = true; reportSize(); });
const ro = new ResizeObserver(() => { if (fontsReady) reportSize(); });
ro.observe(document.getElementById('stage'));
// Re-measure when #root children change (catches async React renders)
const mo = new MutationObserver(() => { requestAnimationFrame(reportSize); });
mo.observe(document.getElementById('root'), { childList: true, subtree: true });

// ─── Error handling ───────────────────────────────────────
window.onerror = (msg, src, line) => { POST('error', { message: String(msg), file: src, line }); };
window.addEventListener('unhandledrejection', (e) => { POST('error', { message: String(e.reason) }); });

// ─── Parent → Harness messages ────────────────────────────
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.type) return;
  if (d.type === 'CANVAS_SET_MODE') {
    applyMode(d.mode, d.viewportWidth);
  }
  if (d.type === 'CANVAS_SET_PROPS') {
    // Future: re-render with new props
  }
});

// ─── Framework mount ──────────────────────────────────────
${mountCode}

let currentPath = null;
async function loadAndMount(componentPath) {
  POST('status', { state: 'loading' });
  try {
    if (cleanup) { cleanup(); cleanup = null; }
    const mod = await import('/' + componentPath + '?t=' + Date.now());
    const Component = mod.default || Object.values(mod).find(v => typeof v === 'function');
    if (!Component) throw new Error('No component export found in ' + componentPath);
    await mount(Component);
    POST('status', { state: 'rendered' });
    // Report size after render settles
    requestAnimationFrame(() => requestAnimationFrame(reportSize));
  } catch (e) {
    document.getElementById('root').innerHTML = '<div class="preview-error">' + (e.message || String(e)) + '</div>';
    POST('error', { message: e.message || String(e) });
  }
}

// ─── HMR ──────────────────────────────────────────────────
window.addEventListener('vite:beforeUpdate', () => {
  if (currentPath) { POST('hmr-update', { file: currentPath }); setTimeout(() => { loadAndMount(currentPath); }, 50); }
});
window.addEventListener('vite:error', (e) => {
  const detail = e.detail || e;
  POST('error', { message: detail.message || String(detail), isCompileError: true });
  document.getElementById('root').innerHTML = '<div class="preview-error">Compile error:\\n' + (detail.message || String(detail)) + '</div>';
});

// ─── Init ─────────────────────────────────────────────────
applyMode(currentMode, viewportWidth);
currentPath = params.get('c');
if (!currentPath) { document.getElementById('root').textContent = 'No component specified'; }
else {
  loadAndMount(currentPath).then(() => {
    POST('ready', { capabilities: { modes: ['intrinsic', 'viewport', 'fill'], hasPortal: true } });
  });
}
</script>
</body>
</html>`
  }

  // component:preview-setup — write framework-specific preview HTML into the project root
  ipcMain.handle('component:preview-setup', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return null
    const filePath = join(projectPath, PREVIEW_FILENAME)
    try {
      const framework = resolveUIFramework(projectPath)
      const resources = resolveHeadResources(projectPath)
      await writeFile(filePath, buildPreviewHtml(framework, resources), 'utf-8')
      return PREVIEW_FILENAME
    } catch (err) {
      console.warn('[component-scanner] Failed to write preview HTML:', err)
      return null
    }
  })

  // component:preview-cleanup — remove the preview HTML file
  ipcMain.handle('component:preview-cleanup', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return
    const filePath = join(projectPath, PREVIEW_FILENAME)
    try {
      await access(filePath)
      await unlink(filePath)
    } catch { /* file doesn't exist, nothing to clean */ }
  })
}
