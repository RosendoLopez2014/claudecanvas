import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { ipcMain } from 'electron'

/**
 * Lightweight component parser for auto-gallery.
 * Extracts the default export name from a .tsx/.jsx file
 * and generates minimal render HTML for gallery preview.
 *
 * This is intentionally simple (regex-based, no AST) —
 * it handles the 80% case of `export default function Foo`
 * and `export default Foo` patterns.
 */

const COMPONENT_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js'])

/** Patterns that indicate a file is in a components directory */
const COMPONENT_PATH_PATTERN = /[/\\](components?|ui|widgets|views|pages)[/\\]/i

export interface ParsedComponent {
  name: string
  filePath: string
  renderHtml: string
}

/**
 * Try to extract the default-exported component name from file contents.
 * Returns null if no default export or not a component (lowercase name).
 */
function extractComponentName(source: string, fileName: string): string | null {
  // Pattern 1: export default function ComponentName
  const funcMatch = source.match(/export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/)
  if (funcMatch) return funcMatch[1]

  // Pattern 2: export default class ComponentName
  const classMatch = source.match(/export\s+default\s+class\s+([A-Z][A-Za-z0-9_]*)/)
  if (classMatch) return classMatch[1]

  // Pattern 3: export default ComponentName (at end of file, referencing earlier declaration)
  const refMatch = source.match(/export\s+default\s+([A-Z][A-Za-z0-9_]*)\s*;?\s*$/)
  if (refMatch) return refMatch[1]

  // Pattern 4: const ComponentName = ... ; export default ComponentName
  const constExportMatch = source.match(
    /(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=[\s\S]*?export\s+default\s+\1/
  )
  if (constExportMatch) return constExportMatch[1]

  // Fallback: derive from filename if PascalCase
  const name = basename(fileName, extname(fileName))
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return name

  return null
}

/**
 * Generate minimal render HTML for a component.
 * This creates a simple wrapper that imports and renders the component.
 */
function generateRenderHtml(componentName: string): string {
  return `<div style="padding:16px;font-family:system-ui,sans-serif">
  <div style="margin-bottom:8px;font-size:12px;color:#666;font-weight:500">${componentName}</div>
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;background:#fff">
    <div style="color:#9ca3af;font-size:13px;text-align:center">&lt;${componentName} /&gt;</div>
  </div>
</div>`
}

/**
 * Parse a component file and return parsed info, or null if not a component.
 */
export function parseComponentFile(filePath: string): ParsedComponent | null {
  const ext = extname(filePath)
  if (!COMPONENT_EXTENSIONS.has(ext)) return null

  try {
    const source = readFileSync(filePath, 'utf-8')
    const name = extractComponentName(source, filePath)
    if (!name) return null

    return {
      name,
      filePath,
      renderHtml: generateRenderHtml(name),
    }
  } catch {
    return null
  }
}

/**
 * Check if a file path looks like it's in a components directory.
 */
export function isComponentPath(filePath: string): boolean {
  const ext = extname(filePath)
  if (!COMPONENT_EXTENSIONS.has(ext)) return false
  return COMPONENT_PATH_PATTERN.test(filePath)
}

export function setupComponentParserHandlers(): void {
  ipcMain.handle('component:parse', (_event, filePath: string) => {
    return parseComponentFile(filePath)
  })
}
