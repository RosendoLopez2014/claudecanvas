import { ipcMain } from 'electron'
import { readdir, readFile } from 'fs/promises'
import { join, extname } from 'path'

interface SearchResult {
  filePath: string
  relativePath: string
  lineNumber: number
  lineContent: string
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt', '.output',
  '.cache', '.turbo', '.vercel', '.svelte-kit', 'build',
  'coverage', '__pycache__'
])

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.less',
  '.html', '.md', '.txt', '.yml', '.yaml', '.toml', '.env',
  '.sh', '.bash', '.zsh', '.py', '.rb', '.go', '.rs', '.java',
  '.svelte', '.vue', '.astro', '.prisma', '.graphql', '.sql',
  '.xml', '.svg', '.mjs', '.cjs'
])

const MAX_RESULTS = 200
const MAX_FILE_SIZE = 512 * 1024 // 512 KB

async function searchInDirectory(
  dirPath: string,
  rootPath: string,
  query: string,
  caseSensitive: boolean,
  results: SearchResult[]
): Promise<void> {
  if (results.length >= MAX_RESULTS) return

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return

    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      await searchInDirectory(fullPath, rootPath, query, caseSensitive, results)
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      try {
        const { size } = await import('fs').then(fs => fs.statSync(fullPath))
        if (size > MAX_FILE_SIZE) continue

        const content = await readFile(fullPath, 'utf-8')
        const lines = content.split('\n')
        const searchQuery = caseSensitive ? query : query.toLowerCase()

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_RESULTS) break
          const line = caseSensitive ? lines[i] : lines[i].toLowerCase()
          if (line.includes(searchQuery)) {
            results.push({
              filePath: fullPath,
              relativePath: fullPath.replace(rootPath + '/', ''),
              lineNumber: i + 1,
              lineContent: lines[i].trim().slice(0, 200)
            })
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export function setupSearchHandlers(): void {
  ipcMain.handle(
    'search:project',
    async (_event, rootPath: string, query: string, caseSensitive = false) => {
      if (!query || query.length < 2) return []
      const results: SearchResult[] = []
      await searchInDirectory(rootPath, rootPath, query, caseSensitive, results)
      return results
    }
  )
}
