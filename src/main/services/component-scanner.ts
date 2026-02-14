import { ipcMain } from 'electron'
import { readdir } from 'fs/promises'
import { join, extname } from 'path'

interface ScannedComponent {
  name: string
  filePath: string
  relativePath: string
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '__tests__', '__mocks__'])

async function scanDirectory(dirPath: string, rootPath: string, results: ScannedComponent[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      await scanDirectory(fullPath, rootPath, results)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if ((ext === '.tsx' || ext === '.jsx') && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
        // Extract component name from filename (PascalCase convention)
        const baseName = entry.name.replace(/\.(tsx|jsx)$/, '')
        if (baseName[0] === baseName[0].toUpperCase() && baseName !== 'index') {
          results.push({
            name: baseName,
            filePath: fullPath,
            relativePath: fullPath.replace(rootPath + '/', '')
          })
        }
      }
    }
  }
}

export function setupComponentScannerHandlers(): void {
  ipcMain.handle('component:scan', async (_event, projectPath: string) => {
    const results: ScannedComponent[] = []

    // Scan common component directories
    const componentDirs = [
      join(projectPath, 'src', 'components'),
      join(projectPath, 'src', 'app'),
      join(projectPath, 'components'),
      join(projectPath, 'app'),
    ]

    for (const dir of componentDirs) {
      await scanDirectory(dir, projectPath, results)
    }

    return results
  })
}
