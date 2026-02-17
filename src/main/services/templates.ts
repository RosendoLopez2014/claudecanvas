import { ipcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface TemplateInfo {
  id: string
  name: string
  description: string
  icon: string
  command: string[]
  devCommand: string
  devPort: number
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    description: 'React framework with App Router, SSR, and API routes',
    icon: 'nextjs',
    command: ['npx', 'create-next-app@latest', '--ts', '--app', '--tailwind', '--eslint', '--src-dir', '--import-alias', '@/*', '--use-npm'],
    devCommand: 'npm run dev',
    devPort: 3000,
  },
  {
    id: 'vite-react',
    name: 'Vite + React',
    description: 'Lightning-fast React with TypeScript and HMR',
    icon: 'vite',
    command: ['npm', 'create', 'vite@latest', '--', '--template', 'react-ts'],
    devCommand: 'npm run dev',
    devPort: 5173,
  },
  {
    id: 'astro',
    name: 'Astro',
    description: 'Content-focused framework with island architecture',
    icon: 'astro',
    command: ['npm', 'create', 'astro@latest', '--', '--template', 'basics', '--install', '--no-git', '-y'],
    devCommand: 'npm run dev',
    devPort: 4321,
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    description: 'Full-stack Svelte with file-based routing',
    icon: 'svelte',
    command: ['npm', 'create', 'svelte@latest', '--', '--template', 'skeleton', '--types', 'typescript'],
    devCommand: 'npm run dev',
    devPort: 5173,
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty project — let Claude Code set up everything',
    icon: 'blank',
    command: [],
    devCommand: '',
    devPort: 3000,
  },
]

export function setupTemplateHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('template:list', () => TEMPLATES)

  ipcMain.handle(
    'template:scaffold',
    async (
      _event,
      opts: { templateId: string; projectName: string; parentDir: string }
    ): Promise<{ success: boolean; path: string; error?: string }> => {
      const template = TEMPLATES.find((t) => t.id === opts.templateId)
      if (!template) return { success: false, path: '', error: 'Unknown template' }

      const projectPath = join(opts.parentDir, opts.projectName)

      // Blank template: just create the directory
      if (template.command.length === 0) {
        if (!existsSync(projectPath)) {
          mkdirSync(projectPath, { recursive: true })
        }
        return { success: true, path: projectPath }
      }

      // Build command with project name injected
      const [bin, ...args] = template.command
      // For create-next-app, project name is the last positional arg
      // For npm create vite, project name comes before --
      const fullArgs = [...args, opts.projectName]

      return new Promise((resolve) => {
        const win = getWindow()
        const proc = spawn(bin, fullArgs, {
          cwd: opts.parentDir,
          env: { ...process.env, npm_config_yes: 'true' },
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        let output = ''

        proc.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          output += text
          if (win && !win.isDestroyed()) {
            win.webContents.send('template:progress', { text: text.trim() })
          }
        })

        proc.stderr?.on('data', (data: Buffer) => {
          const text = data.toString()
          output += text
          // Some scaffold tools (e.g. npm) write progress to stderr
          if (win && !win.isDestroyed()) {
            win.webContents.send('template:progress', { text: text.trim() })
          }
        })

        // Auto-answer "yes" to any stdin prompts
        proc.stdin?.write('y\n')
        proc.stdin?.end()

        proc.on('close', (code) => {
          if (code === 0 || existsSync(projectPath)) {
            resolve({ success: true, path: projectPath })
          } else {
            resolve({ success: false, path: projectPath, error: `Scaffold exited with code ${code}` })
          }
        })

        proc.on('error', (err) => {
          resolve({ success: false, path: projectPath, error: err.message })
        })

        // Timeout after 120s
        setTimeout(() => {
          try { proc.kill() } catch {}
          resolve({ success: false, path: projectPath, error: 'Scaffold timed out after 120s' })
        }, 120_000)
      })
    }
  )
}
