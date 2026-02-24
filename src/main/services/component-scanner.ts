import { ipcMain } from 'electron'
import { readdir, readFile } from 'fs/promises'
import { join, relative, extname, basename } from 'path'
import { isValidPath } from '../validate'

interface ScannedComponent {
  name: string
  filePath: string
  relativePath: string
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt', '.output',
  '.cache', '.turbo', '.vercel', '.svelte-kit', 'build',
  'coverage', '__pycache__'
])

const IGNORE_PATTERNS = ['.test.', '.spec.', '.stories.']

const COMPONENT_EXTENSIONS = new Set(['.tsx', '.jsx'])

const MAX_DEPTH = 5

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
 */
function parseComponentName(content: string): string | null {
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
  const base = basename(fileName).replace(/\.(tsx|jsx)$/, '')
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
        const parsedName = parseComponentName(content)
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
        name = parseComponentName(content) || fileNameToComponentName(basename(filePath))
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
}
