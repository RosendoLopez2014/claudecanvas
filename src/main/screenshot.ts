import { BrowserWindow, ipcMain } from 'electron'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let latestScreenshotPath: string | null = null

export function getLatestScreenshotPath(): string | null {
  return latestScreenshotPath
}

export async function getLatestScreenshotBase64(): Promise<{ data: string; mimeType: string } | null> {
  if (!latestScreenshotPath) return null
  try {
    const buffer = await readFile(latestScreenshotPath)
    return { data: buffer.toString('base64'), mimeType: 'image/png' }
  } catch {
    return null
  }
}

function screenshotDir(projectPath: string): string {
  return join(projectPath, '.claude', 'screenshots')
}

export function setupScreenshotHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'screenshot:capture',
    async (_event, rect: { x: number; y: number; width: number; height: number }) => {
      const win = getWindow()
      if (!win) throw new Error('No window available')

      const image = await win.webContents.capturePage(rect)
      const png = image.toPNG()

      const filename = `claude-canvas-screenshot-${Date.now()}.png`
      const filepath = join(tmpdir(), filename)
      await writeFile(filepath, png)

      latestScreenshotPath = filepath
      return filepath
    }
  )

  // Capture the full window as a checkpoint screenshot
  ipcMain.handle(
    'screenshot:captureCheckpoint',
    async (_event, hash: string, projectPath: string) => {
      const win = getWindow()
      if (!win) return null

      try {
        const image = await win.webContents.capturePage()
        const png = image.toPNG()

        const dir = screenshotDir(projectPath)
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true })
        }

        const filepath = join(dir, `${hash}.png`)
        await writeFile(filepath, png)
        return filepath
      } catch (err) {
        console.error('Failed to capture checkpoint screenshot:', err)
        return null
      }
    }
  )

  // Load a checkpoint screenshot as base64 data URL
  ipcMain.handle(
    'screenshot:loadCheckpoint',
    async (_event, hash: string, projectPath: string) => {
      const dir = screenshotDir(projectPath)
      const filepath = join(dir, `${hash}.png`)

      if (!existsSync(filepath)) return null

      try {
        const buffer = await readFile(filepath)
        return `data:image/png;base64,${buffer.toString('base64')}`
      } catch {
        return null
      }
    }
  )
}
