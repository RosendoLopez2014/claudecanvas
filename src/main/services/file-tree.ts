import { ipcMain } from 'electron'
import { readdir, readFile, stat } from 'fs/promises'
import { join, basename } from 'path'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt', '.output',
  '.cache', '.turbo', '.vercel', '.svelte-kit', 'build',
  'coverage', '__pycache__', '.DS_Store'
])

async function readTree(dirPath: string, depth: number): Promise<FileNode[]> {
  if (depth <= 0) return []

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileNode[] = []

  // Sort: directories first, then files, alphabetical within each group
  const sorted = entries
    .filter((e) => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  for (const entry of sorted) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await readTree(fullPath, depth - 1)
      nodes.push({ name: entry.name, path: fullPath, type: 'directory', children })
    } else {
      nodes.push({ name: entry.name, path: fullPath, type: 'file' })
    }
  }

  return nodes
}

export function setupFileTreeHandlers(): void {
  ipcMain.handle('fs:tree', async (_event, rootPath: string, depth = 4) => {
    return readTree(rootPath, depth)
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return await readFile(filePath, 'utf-8')
    } catch {
      return null
    }
  })
}
