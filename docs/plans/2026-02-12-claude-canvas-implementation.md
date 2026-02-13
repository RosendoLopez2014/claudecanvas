# Claude Canvas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a terminal-first Electron development environment with adaptive rendering — small components render inline in the terminal, large components and running apps render in a right-side canvas panel with an element inspector.

**Architecture:** Electron app with three processes (main, preload, renderer). Main process handles PTY, file watching, project management, and render routing. Renderer is a React 19 app with xterm.js terminal, adaptive canvas panel, and inline render system. All IPC flows through a typed preload bridge with context isolation.

**Tech Stack:** Electron 33+, electron-vite 3, React 19, TypeScript, xterm.js 5 (WebGL), node-pty, Zustand, Tailwind CSS 4, Framer Motion, allotment, chokidar, Radix UI

---

## Phase 1: Foundation (Tasks 1-5)

### Task 1: Scaffold Electron-Vite Project

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`

**Step 1: Create package.json**

```json
{
  "name": "claude-canvas",
  "version": "0.1.0",
  "description": "Terminal-first development environment with adaptive rendering",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "rebuild": "electron-rebuild -f -w node-pty",
    "postinstall": "electron-builder install-app-deps",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-unicode11": "^0.8.0",
    "@xterm/addon-search": "^0.15.0",
    "@xterm/addon-serialize": "^0.13.0",
    "node-pty": "^1.0.0",
    "zustand": "^5.0.0",
    "framer-motion": "^12.0.0",
    "lucide-react": "^0.460.0",
    "allotment": "^1.20.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "chokidar": "^4.0.0",
    "electron-store": "^10.0.0",
    "simple-git": "^3.25.0",
    "detect-port": "^2.1.0",
    "tree-kill": "^1.2.2"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^3.0.0",
    "electron-builder": "^25.0.0",
    "@electron/rebuild": "^3.6.0",
    "typescript": "^5.7.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vitest": "^2.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0"
  }
}
```

**Step 2: Create electron.vite.config.ts**

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
```

**Step 3: Create tsconfig files**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["electron-vite/node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "jsx": "react-jsx",
    "outDir": "./out",
    "rootDir": "./src/renderer",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/*"]
    }
  },
  "include": ["src/renderer/**/*"]
}
```

**Step 4: Create minimal main process**

`src/main/index.ts`:
```typescript
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0A0F1A',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

**Step 5: Create preload script**

`src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
```

**Step 6: Create renderer entry files**

`src/renderer/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Canvas</title>
  </head>
  <body class="bg-[#0A0F1A] text-white overflow-hidden">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/App.tsx`:
```typescript
export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <div className="h-10 flex items-center px-4 border-b border-white/10 drag-region">
        <span className="text-sm text-white/60 no-drag">Claude Canvas</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-white/40">
        Terminal will appear here
      </div>
    </div>
  )
}
```

`src/renderer/styles/globals.css`:
```css
@import "tailwindcss";

:root {
  --accent-cyan: #4AEAFF;
  --accent-coral: #FF6B4A;
  --bg-primary: #0A0F1A;
  --bg-secondary: #111827;
  --bg-tertiary: #1F2937;
  --border: rgba(255, 255, 255, 0.1);
}

body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}
```

**Step 7: Install dependencies and verify**

Run: `npm install`
Expected: Successful install (node-pty may need rebuild)

Run: `npm run rebuild`
Expected: node-pty rebuilt for Electron

Run: `npm run dev`
Expected: Electron window opens showing "Claude Canvas" title bar and "Terminal will appear here" placeholder

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold electron-vite project with React 19 + TypeScript"
```

---

### Task 2: Create CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

**Step 1: Write CLAUDE.md**

```markdown
# Claude Canvas — Project Context

## Architecture
Electron app (electron-vite 3) with three processes:
- Main process: src/main/ (Node.js — PTY, file watching, project management, IPC)
- Preload: src/preload/ (typed contextBridge for secure IPC)
- Renderer: src/renderer/ (React 19 + xterm.js terminal + adaptive canvas)
- Inspector: src/inspector/ (scripts injected into canvas iframe)

## Core Concept
Terminal-first. Claude Code CLI runs in the embedded terminal as the primary interface.
Canvas renders adaptively: small components inline in terminal, large/full-page in right panel.

## Key Patterns
- All IPC through preload bridge (context isolation ON, never bypass)
- State: Zustand stores (NOT Redux, NOT Context)
- Terminal: xterm.js 5 with WebGL addon (NEVER DOM renderer)
- Styling: Tailwind CSS 4, dark theme
- Accent colors: cyan #4AEAFF, coral #FF6B4A
- Split panes: allotment
- Animations: Framer Motion
- UI primitives: Radix UI

## Commands
- `npm run dev` — electron-vite dev with HMR
- `npm run build` — production build
- `npm run rebuild` — rebuild native modules (node-pty)
- `npm test` — run vitest
- `npm run test:watch` — vitest watch mode

## Don'ts
- Don't use Redux or React Context for app state
- Don't use xterm.js DOM renderer (always WebGL addon)
- Don't bypass the preload bridge for IPC
- Don't use webpack (this project uses Vite via electron-vite)
- Don't add `nodeIntegration: true` to any window
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md project context for Claude Code"
```

---

### Task 3: Window Controls IPC

**Files:**
- Modify: `src/main/index.ts`
- Verify: `src/preload/index.ts` (already has window IPC)

**Step 1: Add window control handlers to main process**

Add to `src/main/index.ts` after `createWindow()` call inside `app.whenReady().then()`:

```typescript
import { ipcMain } from 'electron'

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
```

**Step 2: Verify dev mode still works**

Run: `npm run dev`
Expected: Window opens, no console errors

**Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: add window control IPC handlers"
```

---

### Task 4: Custom Title Bar Component

**Files:**
- Create: `src/renderer/components/TitleBar/TitleBar.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Create TitleBar component**

```typescript
import { Minus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const platform = window.api.platform

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
  }, [])

  const handleMinimize = useCallback(() => window.api.window.minimize(), [])
  const handleMaximize = useCallback(async () => {
    window.api.window.maximize()
    setIsMaximized(await window.api.window.isMaximized())
  }, [])
  const handleClose = useCallback(() => window.api.window.close(), [])

  return (
    <div className="h-10 flex items-center justify-between border-b border-white/10 bg-[var(--bg-primary)] drag-region select-none">
      {/* Left: macOS traffic lights get space, or app title on Windows */}
      <div className="flex items-center gap-2 pl-20">
        <span className="text-xs font-medium text-white/50 no-drag">Claude Canvas</span>
      </div>

      {/* Right: Windows controls (hidden on macOS) */}
      {platform !== 'darwin' && (
        <div className="flex no-drag">
          <button
            onClick={handleMinimize}
            className="h-10 w-12 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <Minus size={14} className="text-white/60" />
          </button>
          <button
            onClick={handleMaximize}
            className="h-10 w-12 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <Square size={12} className="text-white/60" />
          </button>
          <button
            onClick={handleClose}
            className="h-10 w-12 flex items-center justify-center hover:bg-red-500/80 transition-colors"
          >
            <X size={14} className="text-white/60" />
          </button>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Add API type declaration**

Create `src/renderer/env.d.ts`:
```typescript
/// <reference types="vite/client" />

import type { ApiType } from '../preload/index'

declare global {
  interface Window {
    api: ApiType
  }
}
```

**Step 3: Update App.tsx**

```typescript
import { TitleBar } from './components/TitleBar/TitleBar'

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      <div className="flex-1 flex items-center justify-center text-white/40">
        Terminal will appear here
      </div>
    </div>
  )
}
```

**Step 4: Verify**

Run: `npm run dev`
Expected: Custom title bar with "Claude Canvas" label, window controls work

**Step 5: Commit**

```bash
git add src/renderer/components/TitleBar/TitleBar.tsx src/renderer/env.d.ts src/renderer/App.tsx
git commit -m "feat: add custom frameless title bar with window controls"
```

---

### Task 5: Zustand Store Foundation

**Files:**
- Create: `src/renderer/stores/workspace.ts`
- Create: `src/renderer/stores/terminal.ts`
- Create: `src/renderer/stores/canvas.ts`
- Create: `src/renderer/stores/project.ts`

**Step 1: Create workspace store (controls layout state)**

```typescript
import { create } from 'zustand'

export type WorkspaceMode = 'terminal-only' | 'terminal-inline' | 'terminal-canvas'

interface WorkspaceStore {
  mode: WorkspaceMode
  canvasSplit: number // percentage for terminal width when canvas open
  setMode: (mode: WorkspaceMode) => void
  openCanvas: () => void
  closeCanvas: () => void
  setCanvasSplit: (split: number) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  mode: 'terminal-only',
  canvasSplit: 50,
  setMode: (mode) => set({ mode }),
  openCanvas: () => set({ mode: 'terminal-canvas' }),
  closeCanvas: () => set({ mode: 'terminal-only' }),
  setCanvasSplit: (canvasSplit) => set({ canvasSplit })
}))
```

**Step 2: Create terminal store**

```typescript
import { create } from 'zustand'

interface TerminalStore {
  ptyId: string | null
  isRunning: boolean
  setPtyId: (id: string | null) => void
  setIsRunning: (running: boolean) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  ptyId: null,
  isRunning: false,
  setPtyId: (ptyId) => set({ ptyId }),
  setIsRunning: (isRunning) => set({ isRunning })
}))
```

**Step 3: Create canvas store**

```typescript
import { create } from 'zustand'

export type CanvasTab = 'preview' | 'gallery' | 'timeline' | 'diff'

export interface ElementContext {
  tagName: string
  id?: string
  className?: string
  componentName?: string
  filePath?: string
  lineNumber?: number
  rect?: { top: number; left: number; width: number; height: number }
  styles?: Record<string, string>
  html?: string
}

interface CanvasStore {
  activeTab: CanvasTab
  previewUrl: string | null
  inspectorActive: boolean
  selectedElement: ElementContext | null
  setActiveTab: (tab: CanvasTab) => void
  setPreviewUrl: (url: string | null) => void
  setInspectorActive: (active: boolean) => void
  setSelectedElement: (el: ElementContext | null) => void
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  activeTab: 'preview',
  previewUrl: null,
  inspectorActive: false,
  selectedElement: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setInspectorActive: (inspectorActive) => set({ inspectorActive }),
  setSelectedElement: (selectedElement) => set({ selectedElement })
}))
```

**Step 4: Create project store**

```typescript
import { create } from 'zustand'

export interface ProjectInfo {
  name: string
  path: string
  framework?: string
  devCommand?: string
  devPort?: number
  lastOpened?: number
}

type AppScreen = 'onboarding' | 'project-picker' | 'workspace'

interface ProjectStore {
  currentProject: ProjectInfo | null
  recentProjects: ProjectInfo[]
  screen: AppScreen
  isDevServerRunning: boolean
  setCurrentProject: (project: ProjectInfo | null) => void
  setRecentProjects: (projects: ProjectInfo[]) => void
  setScreen: (screen: AppScreen) => void
  setDevServerRunning: (running: boolean) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProject: null,
  recentProjects: [],
  screen: 'onboarding',
  isDevServerRunning: false,
  setCurrentProject: (currentProject) => set({ currentProject }),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  setScreen: (screen) => set({ screen }),
  setDevServerRunning: (isDevServerRunning) => set({ isDevServerRunning })
}))
```

**Step 5: Commit**

```bash
git add src/renderer/stores/
git commit -m "feat: add Zustand stores for workspace, terminal, canvas, and project state"
```

---

## Phase 2: Terminal Core (Tasks 6-9)

### Task 6: PTY Manager in Main Process

**Files:**
- Create: `src/main/pty.ts`
- Modify: `src/main/index.ts` (register IPC handlers)
- Modify: `src/preload/index.ts` (add PTY bridge)

**Step 1: Create PTY manager**

`src/main/pty.ts`:
```typescript
import { spawn, IPty } from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { platform } from 'os'

const ptys = new Map<string, IPty>()
let idCounter = 0

export function setupPtyHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pty:spawn', (_event, shell?: string) => {
    const id = `pty-${++idCounter}`
    const defaultShell = shell || (platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh')

    const ptyProcess = spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || '/',
      env: { ...process.env } as Record<string, string>
    })

    ptys.set(id, ptyProcess)

    // Buffer PTY output and send in batches via RAF-like timing
    let buffer = ''
    let sendScheduled = false

    ptyProcess.onData((data) => {
      buffer += data
      if (!sendScheduled) {
        sendScheduled = true
        setTimeout(() => {
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(`pty:data:${id}`, buffer)
          }
          buffer = ''
          sendScheduled = false
        }, 8) // ~120fps batching
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:exit:${id}`, exitCode)
      }
      ptys.delete(id)
    })

    return id
  })

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    ptys.get(id)?.write(data)
  })

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptys.get(id)?.resize(cols, rows)
  })

  ipcMain.on('pty:kill', (_event, id: string) => {
    ptys.get(id)?.kill()
    ptys.delete(id)
  })

  ipcMain.on('pty:setCwd', (_event, id: string, cwd: string) => {
    ptys.get(id)?.write(`cd ${JSON.stringify(cwd)}\r`)
  })
}

export function killAllPtys(): void {
  for (const [id, pty] of ptys) {
    pty.kill()
    ptys.delete(id)
  }
}
```

**Step 2: Register PTY handlers in main**

Add to `src/main/index.ts`:
```typescript
import { setupPtyHandlers, killAllPtys } from './pty'

// Inside app.whenReady().then():
setupPtyHandlers(() => mainWindow)

// Inside app.on('window-all-closed'):
killAllPtys()
```

**Step 3: Add PTY to preload bridge**

Update `src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  pty: {
    spawn: (shell?: string): Promise<string> =>
      ipcRenderer.invoke('pty:spawn', shell),
    write: (id: string, data: string) =>
      ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) =>
      ipcRenderer.send('pty:kill', id),
    setCwd: (id: string, cwd: string) =>
      ipcRenderer.send('pty:setCwd', id, cwd),
    onData: (id: string, cb: (data: string) => void) => {
      const handler = (_: unknown, data: string) => cb(data)
      ipcRenderer.on(`pty:data:${id}`, handler)
      return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
    },
    onExit: (id: string, cb: (exitCode: number) => void) => {
      const handler = (_: unknown, code: number) => cb(code)
      ipcRenderer.on(`pty:exit:${id}`, handler)
      return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
```

**Step 4: Verify**

Run: `npm run dev`
Expected: App still loads, no errors. PTY handlers registered but not yet wired to UI.

**Step 5: Commit**

```bash
git add src/main/pty.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add PTY manager with batched output and IPC bridge"
```

---

### Task 7: xterm.js Terminal Component

**Files:**
- Create: `src/renderer/components/Terminal/TerminalView.tsx`
- Create: `src/renderer/hooks/usePty.ts`

**Step 1: Create usePty hook**

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '@/stores/terminal'

export function usePty(terminal: Terminal | null) {
  const ptyIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const { setPtyId, setIsRunning } = useTerminalStore()

  const spawn = useCallback(async (cwd?: string) => {
    if (!terminal) return

    const id = await window.api.pty.spawn()
    ptyIdRef.current = id
    setPtyId(id)
    setIsRunning(true)

    // PTY output → terminal
    const removeData = window.api.pty.onData(id, (data) => {
      terminal.write(data)
    })

    const removeExit = window.api.pty.onExit(id, () => {
      setIsRunning(false)
      setPtyId(null)
    })

    cleanupRef.current = [removeData, removeExit]

    // Terminal input → PTY
    const disposable = terminal.onData((data) => {
      window.api.pty.write(id, data)
    })
    cleanupRef.current.push(() => disposable.dispose())

    // Set working directory if provided
    if (cwd) {
      window.api.pty.setCwd(id, cwd)
    }
  }, [terminal, setPtyId, setIsRunning])

  const resize = useCallback((cols: number, rows: number) => {
    if (ptyIdRef.current) {
      window.api.pty.resize(ptyIdRef.current, cols, rows)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current.forEach(fn => fn())
      if (ptyIdRef.current) {
        window.api.pty.kill(ptyIdRef.current)
      }
    }
  }, [])

  return { spawn, resize, ptyId: ptyIdRef.current }
}
```

**Step 2: Create TerminalView component**

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { usePty } from '@/hooks/usePty'

interface TerminalViewProps {
  cwd?: string
}

export function TerminalView({ cwd }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const { spawn, resize } = usePty(terminalRef.current)
  const initializedRef = useRef(false)

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    initializedRef.current = true

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      letterSpacing: 0,
      theme: {
        background: '#0A0F1A',
        foreground: '#C8D6E5',
        cursor: '#4AEAFF',
        cursorAccent: '#0A0F1A',
        selectionBackground: 'rgba(74, 234, 255, 0.2)',
        selectionForeground: '#FFFFFF',
        black: '#1a1e2e',
        red: '#FF6B4A',
        green: '#4ADE80',
        yellow: '#FACC15',
        blue: '#60A5FA',
        magenta: '#C084FC',
        cyan: '#4AEAFF',
        white: '#C8D6E5',
        brightBlack: '#4B5563',
        brightRed: '#FF8A6A',
        brightGreen: '#6EE7A0',
        brightYellow: '#FDE047',
        brightBlue: '#93C5FD',
        brightMagenta: '#D8B4FE',
        brightCyan: '#7EEDFF',
        brightWhite: '#F9FAFB'
      },
      allowProposedApi: true,
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: 'bar'
    })

    terminalRef.current = terminal

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new Unicode11Addon())
    terminal.loadAddon(new SearchAddon())

    terminal.open(containerRef.current)

    // Load WebGL addon after terminal is open
    try {
      terminal.loadAddon(new WebglAddon())
    } catch {
      console.warn('WebGL addon failed to load, using canvas renderer')
    }

    fitAddon.fit()

    return () => {
      terminal.dispose()
      terminalRef.current = null
      initializedRef.current = false
    }
  }, [])

  // Spawn PTY after terminal is ready
  useEffect(() => {
    if (terminalRef.current && initializedRef.current) {
      spawn(cwd)
    }
  }, [spawn, cwd])

  // Handle resize
  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      fitAddonRef.current.fit()
      resize(terminalRef.current.cols, terminalRef.current.rows)
    }
  }, [resize])

  useEffect(() => {
    const observer = new ResizeObserver(handleResize)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }
    return () => observer.disconnect()
  }, [handleResize])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '8px 0 0 8px' }}
    />
  )
}
```

**Step 3: Wire into App.tsx**

```typescript
import { TitleBar } from './components/TitleBar/TitleBar'
import { TerminalView } from './components/Terminal/TerminalView'

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        <TerminalView />
      </div>
    </div>
  )
}
```

**Step 4: Verify**

Run: `npm run dev`
Expected: Full-screen terminal with zsh/bash shell, cyan cursor, dark theme, GPU-accelerated rendering. Typing works, commands execute.

**Step 5: Commit**

```bash
git add src/renderer/components/Terminal/ src/renderer/hooks/usePty.ts src/renderer/App.tsx
git commit -m "feat: add xterm.js terminal with WebGL rendering and PTY integration"
```

---

### Task 8: Status Bar Component

**Files:**
- Create: `src/renderer/components/StatusBar/StatusBar.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Create StatusBar**

```typescript
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { GitBranch, Circle, Eye } from 'lucide-react'

export function StatusBar() {
  const { currentProject, isDevServerRunning } = useProjectStore()
  const { inspectorActive, setInspectorActive } = useCanvasStore()

  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[var(--bg-secondary)] border-t border-white/10 text-[11px] text-white/50">
      <div className="flex items-center gap-3">
        {currentProject && (
          <>
            <span className="text-white/70">{currentProject.name}</span>
            <div className="flex items-center gap-1">
              <GitBranch size={11} />
              <span>main</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isDevServerRunning && (
          <div className="flex items-center gap-1">
            <Circle size={6} className="fill-green-400 text-green-400" />
            <span>Dev server running</span>
          </div>
        )}
        <button
          onClick={() => setInspectorActive(!inspectorActive)}
          className={`flex items-center gap-1 hover:text-white/80 transition-colors ${
            inspectorActive ? 'text-[var(--accent-cyan)]' : ''
          }`}
        >
          <Eye size={11} />
          <span>Inspector</span>
        </button>
      </div>
    </div>
  )
}
```

**Step 2: Update App.tsx**

```typescript
import { TitleBar } from './components/TitleBar/TitleBar'
import { TerminalView } from './components/Terminal/TerminalView'
import { StatusBar } from './components/StatusBar/StatusBar'

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        <TerminalView />
      </div>
      <StatusBar />
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/StatusBar/ src/renderer/App.tsx
git commit -m "feat: add status bar with project info and inspector toggle"
```

---

### Task 9: Workspace Layout with Allotment Split Pane

**Files:**
- Create: `src/renderer/components/Workspace/Workspace.tsx`
- Create: `src/renderer/components/Canvas/CanvasPanel.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Create CanvasPanel placeholder**

```typescript
import { useCanvasStore } from '@/stores/canvas'

export function CanvasPanel() {
  const { previewUrl, activeTab } = useCanvasStore()

  return (
    <div className="h-full flex flex-col bg-[var(--bg-secondary)]">
      {/* Tab bar */}
      <div className="h-8 flex items-center gap-1 px-2 border-b border-white/10">
        {(['preview', 'gallery', 'timeline', 'diff'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => useCanvasStore.getState().setActiveTab(tab)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              activeTab === tab
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            className="w-full h-full border-0"
            title="Canvas Preview"
          />
        ) : (
          <span>No preview available. Start a dev server to see your app here.</span>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Create Workspace with adaptive layout**

```typescript
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { TerminalView } from '../Terminal/TerminalView'
import { CanvasPanel } from '../Canvas/CanvasPanel'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { AnimatePresence, motion } from 'framer-motion'

export function Workspace() {
  const { mode } = useWorkspaceStore()
  const { currentProject } = useProjectStore()

  if (mode === 'terminal-only' || mode === 'terminal-inline') {
    return (
      <div className="h-full">
        <TerminalView cwd={currentProject?.path} />
      </div>
    )
  }

  // terminal-canvas mode
  return (
    <Allotment defaultSizes={[50, 50]}>
      <Allotment.Pane minSize={300}>
        <TerminalView cwd={currentProject?.path} />
      </Allotment.Pane>
      <Allotment.Pane minSize={300}>
        <AnimatePresence>
          <motion.div
            className="h-full"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
          >
            <CanvasPanel />
          </motion.div>
        </AnimatePresence>
      </Allotment.Pane>
    </Allotment>
  )
}
```

**Step 3: Update App.tsx**

```typescript
import { TitleBar } from './components/TitleBar/TitleBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        <Workspace />
      </div>
      <StatusBar />
    </div>
  )
}
```

**Step 4: Verify both modes**

Run: `npm run dev`
Test: Terminal should appear full-width. Open browser devtools, run in console:
```js
// Simulate canvas mode
window.__zustand_workspace?.getState()?.openCanvas()
```
Expected: Split pane appears with canvas panel on right, animated in.

**Step 5: Commit**

```bash
git add src/renderer/components/Workspace/ src/renderer/components/Canvas/ src/renderer/App.tsx
git commit -m "feat: add workspace layout with allotment split pane and canvas panel"
```

---

## Phase 3: Project Management (Tasks 10-13)

### Task 10: Settings Store (electron-store)

**Files:**
- Create: `src/main/store.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Step 1: Create settings store in main process**

`src/main/store.ts`:
```typescript
import Store from 'electron-store'

interface SettingsSchema {
  projectsDir: string
  recentProjects: Array<{
    name: string
    path: string
    framework?: string
    devCommand?: string
    devPort?: number
    lastOpened?: number
  }>
  theme: 'dark'
  onboardingComplete: boolean
  oauthTokens: {
    github?: string
    vercel?: string
    supabase?: string
  }
}

export const settingsStore = new Store<SettingsSchema>({
  defaults: {
    projectsDir: '',
    recentProjects: [],
    theme: 'dark',
    onboardingComplete: false,
    oauthTokens: {}
  }
})

export function setupSettingsHandlers(): void {
  const { ipcMain } = require('electron')

  ipcMain.handle('settings:get', (_event, key: string) => {
    return settingsStore.get(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    settingsStore.set(key, value)
  })

  ipcMain.handle('settings:getAll', () => {
    return settingsStore.store
  })
}
```

**Step 2: Add settings to preload bridge**

Add to the api object in `src/preload/index.ts`:
```typescript
settings: {
  get: (key: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getAll: () => ipcRenderer.invoke('settings:getAll')
}
```

**Step 3: Register in main**

Add to `src/main/index.ts`:
```typescript
import { setupSettingsHandlers } from './store'

// Inside app.whenReady().then():
setupSettingsHandlers()
```

**Step 4: Commit**

```bash
git add src/main/store.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add electron-store settings with IPC bridge"
```

---

### Task 11: Onboarding Wizard

**Files:**
- Create: `src/renderer/components/Onboarding/Wizard.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Create Onboarding Wizard**

```typescript
import { useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
import { motion, AnimatePresence } from 'framer-motion'
import { Folder, Github, ArrowRight, Check } from 'lucide-react'

type Step = 'welcome' | 'directory' | 'services' | 'done'

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>('welcome')
  const [projectsDir, setProjectsDir] = useState('')
  const { setScreen } = useProjectStore()

  const selectDirectory = useCallback(async () => {
    // Uses Electron dialog via IPC
    const dir = await window.api.dialog?.selectDirectory()
    if (dir) setProjectsDir(dir)
  }, [])

  const finish = useCallback(async () => {
    if (projectsDir) {
      await window.api.settings.set('projectsDir', projectsDir)
    }
    await window.api.settings.set('onboardingComplete', true)
    setScreen('project-picker')
  }, [projectsDir, setScreen])

  return (
    <div className="h-full flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="w-[480px]"
        >
          {step === 'welcome' && (
            <div className="text-center space-y-6">
              <div className="text-4xl font-bold bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-coral)] bg-clip-text text-transparent">
                Claude Canvas
              </div>
              <p className="text-white/60 text-sm leading-relaxed">
                A terminal-first development environment with adaptive visual rendering.
                Build with Claude Code and see your work come alive.
              </p>
              <button
                onClick={() => setStep('directory')}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition"
              >
                Get Started <ArrowRight size={16} />
              </button>
            </div>
          )}

          {step === 'directory' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Where do you keep your projects?</h2>
                <p className="text-white/50 text-sm mt-1">Choose the directory where new projects will be created.</p>
              </div>
              <button
                onClick={selectDirectory}
                className="w-full flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-white/20 transition bg-[var(--bg-tertiary)]"
              >
                <Folder size={20} className="text-[var(--accent-cyan)]" />
                <span className="text-sm text-white/70">
                  {projectsDir || 'Select a directory...'}
                </span>
              </button>
              <div className="flex justify-between">
                <button
                  onClick={() => setStep('welcome')}
                  className="text-sm text-white/40 hover:text-white/60"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('services')}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm"
                >
                  Next <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {step === 'services' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Connect services</h2>
                <p className="text-white/50 text-sm mt-1">Optional. You can connect these later in settings.</p>
              </div>
              <div className="space-y-3">
                {[
                  { name: 'GitHub', icon: Github, desc: 'Git hosting & collaboration' },
                ].map((service) => (
                  <button
                    key={service.name}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:border-white/20 transition bg-[var(--bg-tertiary)]"
                  >
                    <service.icon size={18} className="text-white/60" />
                    <div className="text-left">
                      <div className="text-sm text-white/80">{service.name}</div>
                      <div className="text-xs text-white/40">{service.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <button
                  onClick={() => setStep('directory')}
                  className="text-sm text-white/40 hover:text-white/60"
                >
                  Back
                </button>
                <button
                  onClick={finish}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm"
                >
                  <Check size={14} /> Finish Setup
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
```

**Step 2: Add dialog IPC**

Add to `src/main/index.ts`:
```typescript
import { dialog } from 'electron'

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})
```

Add to preload:
```typescript
dialog: {
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory')
}
```

**Step 3: Update App.tsx to use screen routing**

```typescript
import { TitleBar } from './components/TitleBar/TitleBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OnboardingWizard } from './components/Onboarding/Wizard'
import { useProjectStore } from './stores/project'
import { useEffect } from 'react'

export default function App() {
  const { screen, setScreen } = useProjectStore()

  useEffect(() => {
    // Check if onboarding is complete
    window.api.settings.get('onboardingComplete').then((complete) => {
      if (complete) {
        setScreen('project-picker')
      }
    })
  }, [setScreen])

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        {screen === 'onboarding' && <OnboardingWizard />}
        {screen === 'project-picker' && (
          <div className="h-full flex items-center justify-center text-white/40">
            Project picker (Task 12)
          </div>
        )}
        {screen === 'workspace' && <Workspace />}
      </div>
      {screen === 'workspace' && <StatusBar />}
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add src/renderer/components/Onboarding/ src/renderer/App.tsx src/main/index.ts src/preload/index.ts
git commit -m "feat: add onboarding wizard with directory picker and service setup"
```

---

### Task 12: Project Picker

**Files:**
- Create: `src/renderer/components/Onboarding/ProjectPicker.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Create ProjectPicker**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { useProjectStore, ProjectInfo } from '@/stores/project'
import { Plus, FolderOpen, Clock } from 'lucide-react'
import { motion } from 'framer-motion'

export function ProjectPicker() {
  const { setCurrentProject, setScreen, setRecentProjects, recentProjects } = useProjectStore()
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  useEffect(() => {
    window.api.settings.get('recentProjects').then((projects) => {
      if (projects) setRecentProjects(projects as ProjectInfo[])
    })
  }, [setRecentProjects])

  const openProject = useCallback(async (project: ProjectInfo) => {
    project.lastOpened = Date.now()
    setCurrentProject(project)
    setScreen('workspace')

    // Update recent projects
    const updated = [project, ...recentProjects.filter(p => p.path !== project.path)].slice(0, 10)
    setRecentProjects(updated)
    await window.api.settings.set('recentProjects', updated)
  }, [setCurrentProject, setScreen, recentProjects, setRecentProjects])

  const openExisting = useCallback(async () => {
    const dir = await window.api.dialog?.selectDirectory()
    if (!dir) return
    const name = dir.split('/').pop() || 'project'
    openProject({ name, path: dir })
  }, [openProject])

  const createNew = useCallback(async () => {
    if (!newProjectName.trim()) return
    const projectsDir = await window.api.settings.get('projectsDir') as string
    if (!projectsDir) return

    const path = `${projectsDir}/${newProjectName.trim()}`
    openProject({ name: newProjectName.trim(), path })
  }, [newProjectName, openProject])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-[560px] space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-coral)] bg-clip-text text-transparent">
            Claude Canvas
          </h1>
          <p className="text-white/40 text-sm mt-1">What are we building today?</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => setShowNewProject(true)}
            className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-cyan)]/40 transition bg-[var(--bg-tertiary)] group"
          >
            <Plus size={18} className="text-[var(--accent-cyan)] group-hover:scale-110 transition-transform" />
            <div className="text-left">
              <div className="text-sm font-medium text-white/80">New Project</div>
              <div className="text-xs text-white/40">Start from scratch</div>
            </div>
          </button>
          <button
            onClick={openExisting}
            className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-coral)]/40 transition bg-[var(--bg-tertiary)] group"
          >
            <FolderOpen size={18} className="text-[var(--accent-coral)] group-hover:scale-110 transition-transform" />
            <div className="text-left">
              <div className="text-sm font-medium text-white/80">Open Existing</div>
              <div className="text-xs text-white/40">Browse for a project</div>
            </div>
          </button>
        </div>

        {/* New project form */}
        {showNewProject && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-3"
          >
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createNew()}
              placeholder="Project name..."
              autoFocus
              className="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent-cyan)]/50"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewProject(false)}
                className="px-4 py-1.5 text-xs text-white/40 hover:text-white/60"
              >
                Cancel
              </button>
              <button
                onClick={createNew}
                className="px-4 py-1.5 text-xs bg-[var(--accent-cyan)] text-black rounded-md font-medium"
              >
                Create
              </button>
            </div>
          </motion.div>
        )}

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-white/30">
              <Clock size={12} />
              <span>Recent</span>
            </div>
            <div className="space-y-1">
              {recentProjects.map((project) => (
                <button
                  key={project.path}
                  onClick={() => openProject(project)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 transition text-left"
                >
                  <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center text-xs text-white/40">
                    {project.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm text-white/80">{project.name}</div>
                    <div className="text-xs text-white/30">{project.path}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Update App.tsx**

Replace the project-picker placeholder:
```typescript
{screen === 'project-picker' && <ProjectPicker />}
```

**Step 3: Commit**

```bash
git add src/renderer/components/Onboarding/ProjectPicker.tsx src/renderer/App.tsx
git commit -m "feat: add project picker with new/open/recent project support"
```

---

### Task 13: File Watcher and Dev Server Detection

**Files:**
- Create: `src/main/watcher.ts`
- Create: `src/main/services/dev-server.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Step 1: Create file watcher**

`src/main/watcher.ts`:
```typescript
import { watch, FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'

let watcher: FSWatcher | null = null

export function setupFileWatcher(getWindow: () => BrowserWindow | null): void {
  const { ipcMain } = require('electron')

  ipcMain.handle('fs:watch', (_event, projectPath: string) => {
    if (watcher) watcher.close()

    watcher = watch(projectPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/out/**',
        '**/.next/**'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })

    watcher.on('change', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:change', path)
      }
    })

    watcher.on('add', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:add', path)
      }
    })

    watcher.on('unlink', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:unlink', path)
      }
    })

    return true
  })

  ipcMain.handle('fs:unwatch', () => {
    watcher?.close()
    watcher = null
  })
}

export function closeWatcher(): void {
  watcher?.close()
}
```

**Step 2: Create dev server manager**

`src/main/services/dev-server.ts`:
```typescript
import { spawn, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import * as detectPort from 'detect-port'
import * as treeKill from 'tree-kill'

let devProcess: ChildProcess | null = null

export function setupDevServerHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dev:start', async (_event, cwd: string, command?: string) => {
    if (devProcess) return { error: 'Dev server already running' }

    const cmd = command || 'npm run dev'
    const [bin, ...args] = cmd.split(' ')

    devProcess = spawn(bin, args, {
      cwd,
      shell: true,
      env: { ...process.env, BROWSER: 'none', PORT: '3000' }
    })

    // Detect the port the server starts on
    let port: number | null = null
    const portPromise = new Promise<number>((resolve) => {
      const checkPort = async () => {
        for (let p = 3000; p <= 3010; p++) {
          const available = await detectPort(p)
          if (available !== p) {
            resolve(p)
            return
          }
        }
        setTimeout(checkPort, 500)
      }
      setTimeout(checkPort, 1000)
    })

    devProcess.stdout?.on('data', (data) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', data.toString())
      }
    })

    devProcess.stderr?.on('data', (data) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', data.toString())
      }
    })

    devProcess.on('exit', (code) => {
      devProcess = null
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:exit', code)
      }
    })

    port = await Promise.race([
      portPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
    ])

    return { port, pid: devProcess?.pid }
  })

  ipcMain.handle('dev:stop', () => {
    if (devProcess?.pid) {
      treeKill(devProcess.pid, 'SIGTERM')
      devProcess = null
    }
  })
}

export function killDevServer(): void {
  if (devProcess?.pid) {
    treeKill(devProcess.pid, 'SIGTERM')
    devProcess = null
  }
}
```

**Step 3: Add to preload and main**

Preload additions:
```typescript
fs: {
  watch: (path: string) => ipcRenderer.invoke('fs:watch', path),
  unwatch: () => ipcRenderer.invoke('fs:unwatch'),
  onChange: (cb: (path: string) => void) => {
    const handler = (_: unknown, path: string) => cb(path)
    ipcRenderer.on('fs:change', handler)
    return () => ipcRenderer.removeListener('fs:change', handler)
  }
},
dev: {
  start: (cwd: string, command?: string) => ipcRenderer.invoke('dev:start', cwd, command),
  stop: () => ipcRenderer.invoke('dev:stop'),
  onOutput: (cb: (data: string) => void) => {
    const handler = (_: unknown, data: string) => cb(data)
    ipcRenderer.on('dev:output', handler)
    return () => ipcRenderer.removeListener('dev:output', handler)
  },
  onExit: (cb: (code: number) => void) => {
    const handler = (_: unknown, code: number) => cb(code)
    ipcRenderer.on('dev:exit', handler)
    return () => ipcRenderer.removeListener('dev:exit', handler)
  }
}
```

Main process additions:
```typescript
import { setupFileWatcher, closeWatcher } from './watcher'
import { setupDevServerHandlers, killDevServer } from './services/dev-server'

// Inside app.whenReady():
setupFileWatcher(() => mainWindow)
setupDevServerHandlers(() => mainWindow)

// Inside window-all-closed:
closeWatcher()
killDevServer()
```

**Step 4: Commit**

```bash
git add src/main/watcher.ts src/main/services/dev-server.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add file watcher and dev server management"
```

---

## Phase 4: Canvas & Inspector (Tasks 14-17)

### Task 14: Canvas Preview with iframe

**Files:**
- Modify: `src/renderer/components/Canvas/CanvasPanel.tsx`
- Create: `src/renderer/hooks/useFileWatcher.ts`

**Step 1: Create useFileWatcher hook**

```typescript
import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/project'

export function useFileWatcher(onFileChange: (path: string) => void) {
  const { currentProject } = useProjectStore()
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!currentProject?.path) return

    window.api.fs.watch(currentProject.path)
    cleanupRef.current = window.api.fs.onChange(onFileChange)

    return () => {
      cleanupRef.current?.()
      window.api.fs.unwatch()
    }
  }, [currentProject?.path, onFileChange])
}
```

**Step 2: Update CanvasPanel with live iframe + reload on file change**

```typescript
import { useCanvasStore, CanvasTab } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { useCallback, useRef } from 'react'
import { X, RotateCw, Maximize2, Minimize2 } from 'lucide-react'

export function CanvasPanel() {
  const { previewUrl, activeTab, setActiveTab } = useCanvasStore()
  const { closeCanvas } = useWorkspaceStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const reloadIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }, [])

  // Reload canvas on file changes (debounced by chokidar's awaitWriteFinish)
  useFileWatcher(
    useCallback((path: string) => {
      if (path.match(/\.(tsx?|jsx?|css|html)$/)) {
        // Let HMR handle it — the Vite dev server will push updates
        // Only hard reload if HMR fails (detected via iframe error)
      }
    }, [])
  )

  const tabs: CanvasTab[] = ['preview', 'gallery', 'timeline', 'diff']

  return (
    <div className="h-full flex flex-col bg-[var(--bg-secondary)]">
      {/* Tab bar with controls */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-white/10">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === tab
                  ? 'bg-white/10 text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={reloadIframe} className="p-1 hover:bg-white/10 rounded transition-colors">
            <RotateCw size={12} className="text-white/40" />
          </button>
          <button onClick={closeCanvas} className="p-1 hover:bg-white/10 rounded transition-colors">
            <X size={12} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {activeTab === 'preview' && (
          previewUrl ? (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0 bg-white"
              title="Canvas Preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Start a dev server to see your app here
            </div>
          )
        )}
        {activeTab === 'gallery' && (
          <div className="h-full flex items-center justify-center text-white/30 text-sm">
            Gallery — component variants (Phase 5)
          </div>
        )}
        {activeTab === 'timeline' && (
          <div className="h-full flex items-center justify-center text-white/30 text-sm">
            Timeline — checkpoint snapshots (Phase 5)
          </div>
        )}
        {activeTab === 'diff' && (
          <div className="h-full flex items-center justify-center text-white/30 text-sm">
            Diff — visual comparison (Phase 5)
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/Canvas/CanvasPanel.tsx src/renderer/hooks/useFileWatcher.ts
git commit -m "feat: canvas preview panel with iframe and file watcher integration"
```

---

### Task 15: Inspector Overlay (Injected into iframe)

**Files:**
- Create: `src/inspector/overlay.ts`
- Create: `src/inspector/fiber-walker.ts`
- Create: `src/inspector/style-extractor.ts`

**Step 1: Create fiber walker**

`src/inspector/fiber-walker.ts`:
```typescript
export interface SourceInfo {
  fileName: string
  lineNumber: number
  columnNumber?: number
  componentName: string
}

export function getFiberFromDOM(element: HTMLElement): any | null {
  const key = Object.keys(element).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
  )
  return key ? (element as any)[key] : null
}

export function getSourceInfo(element: HTMLElement): SourceInfo | null {
  let fiber = getFiberFromDOM(element)
  if (!fiber) return null

  while (fiber) {
    if (fiber._debugSource) {
      const name =
        fiber.type?.displayName ||
        fiber.type?.name ||
        (typeof fiber.type === 'string' ? fiber.type : 'Unknown')
      return {
        fileName: fiber._debugSource.fileName,
        lineNumber: fiber._debugSource.lineNumber,
        columnNumber: fiber._debugSource.columnNumber,
        componentName: name
      }
    }
    fiber = fiber.return
  }
  return null
}

export function getComponentName(element: HTMLElement): string {
  let fiber = getFiberFromDOM(element)
  while (fiber) {
    if (typeof fiber.type === 'function' || typeof fiber.type === 'object') {
      return fiber.type?.displayName || fiber.type?.name || 'Component'
    }
    fiber = fiber.return
  }
  return element.tagName.toLowerCase()
}
```

**Step 2: Create style extractor**

`src/inspector/style-extractor.ts`:
```typescript
export interface ExtractedStyles {
  display: string
  position: string
  width: string
  height: string
  padding: string
  margin: string
  backgroundColor: string
  color: string
  fontSize: string
  fontWeight: string
  borderRadius: string
  border: string
}

const STYLE_KEYS: (keyof ExtractedStyles)[] = [
  'display', 'position', 'width', 'height',
  'padding', 'margin', 'backgroundColor', 'color',
  'fontSize', 'fontWeight', 'borderRadius', 'border'
]

export function extractStyles(element: HTMLElement): ExtractedStyles {
  const computed = getComputedStyle(element)
  const styles = {} as ExtractedStyles
  for (const key of STYLE_KEYS) {
    styles[key] = computed.getPropertyValue(
      key.replace(/([A-Z])/g, '-$1').toLowerCase()
    )
  }
  return styles
}
```

**Step 3: Create inspector overlay**

`src/inspector/overlay.ts`:
```typescript
import { getSourceInfo, getComponentName, SourceInfo } from './fiber-walker'
import { extractStyles, ExtractedStyles } from './style-extractor'

interface InspectorMessage {
  type: string
  element?: {
    tagName: string
    id?: string
    className?: string
    componentName: string
    sourceInfo: SourceInfo | null
    styles: ExtractedStyles
    rect: { top: number; left: number; width: number; height: number }
    html: string
  }
}

class InspectorOverlay {
  private container: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private tooltip: HTMLDivElement | null = null
  private active = false
  private currentElement: HTMLElement | null = null

  init(): void {
    this.container = document.createElement('div')
    this.container.id = '__claude_inspector__'
    this.container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 999999;
    `
    document.body.appendChild(this.container)

    this.highlight = document.createElement('div')
    this.highlight.style.cssText = `
      position: fixed; pointer-events: none; transition: all 0.1s ease;
      border: 2px solid #4AEAFF; background: rgba(74, 234, 255, 0.08);
      border-radius: 2px; display: none;
    `
    this.container.appendChild(this.highlight)

    this.tooltip = document.createElement('div')
    this.tooltip.style.cssText = `
      position: fixed; pointer-events: none; background: rgba(10, 15, 26, 0.95);
      color: #C8D6E5; padding: 6px 10px; font-size: 11px; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; display: none; white-space: nowrap;
      border: 1px solid rgba(74, 234, 255, 0.3);
    `
    this.container.appendChild(this.tooltip)

    document.addEventListener('mousemove', this.handleMouseMove, true)
    document.addEventListener('click', this.handleClick, true)

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'inspector:activate') this.active = true
      if (e.data?.type === 'inspector:deactivate') {
        this.active = false
        this.hideHighlight()
      }
    })
  }

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.active) return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement
    if (!el || el.id === '__claude_inspector__' || this.container?.contains(el)) return
    if (el === this.currentElement) return

    this.currentElement = el
    this.showHighlight(el)
  }

  private handleClick = (e: MouseEvent): void => {
    if (!this.active) return
    e.preventDefault()
    e.stopPropagation()

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement
    if (!el || this.container?.contains(el)) return

    const rect = el.getBoundingClientRect()
    const sourceInfo = getSourceInfo(el)
    const componentName = getComponentName(el)
    const styles = extractStyles(el)

    const message: InspectorMessage = {
      type: 'inspector:elementSelected',
      element: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: el.className || undefined,
        componentName,
        sourceInfo,
        styles,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        html: el.outerHTML.substring(0, 300)
      }
    }

    window.parent.postMessage(message, '*')
  }

  private showHighlight(el: HTMLElement): void {
    if (!this.highlight || !this.tooltip) return
    const rect = el.getBoundingClientRect()

    this.highlight.style.top = `${rect.top}px`
    this.highlight.style.left = `${rect.left}px`
    this.highlight.style.width = `${rect.width}px`
    this.highlight.style.height = `${rect.height}px`
    this.highlight.style.display = 'block'

    const name = getComponentName(el)
    const tag = el.tagName.toLowerCase()
    this.tooltip.textContent = name !== tag ? `<${tag}> ${name}` : `<${tag}>`
    this.tooltip.style.top = `${rect.top - 28}px`
    this.tooltip.style.left = `${rect.left}px`
    this.tooltip.style.display = 'block'

    document.body.style.cursor = 'crosshair'
  }

  private hideHighlight(): void {
    if (this.highlight) this.highlight.style.display = 'none'
    if (this.tooltip) this.tooltip.style.display = 'none'
    this.currentElement = null
    document.body.style.cursor = ''
  }
}

// Auto-init when injected
const inspector = new InspectorOverlay()
inspector.init()
```

**Step 4: Commit**

```bash
git add src/inspector/
git commit -m "feat: add inspector overlay with fiber walking and style extraction"
```

---

### Task 16: Inspector Integration (Canvas ↔ Terminal)

**Files:**
- Create: `src/renderer/hooks/useInspector.ts`
- Modify: `src/renderer/components/Canvas/CanvasPanel.tsx`

**Step 1: Create useInspector hook**

```typescript
import { useEffect, useCallback, useRef } from 'react'
import { useCanvasStore, ElementContext } from '@/stores/canvas'
import { useTerminalStore } from '@/stores/terminal'

export function useInspector(iframeRef: React.RefObject<HTMLIFrameElement | null>) {
  const { inspectorActive, setSelectedElement, setInspectorActive } = useCanvasStore()
  const { ptyId } = useTerminalStore()

  // Listen for messages from inspector overlay in iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'inspector:elementSelected') {
        const el = event.data.element
        setSelectedElement(el)
        pasteContextToTerminal(el)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [setSelectedElement, ptyId])

  // Toggle inspector in iframe
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return

    iframe.contentWindow.postMessage(
      { type: inspectorActive ? 'inspector:activate' : 'inspector:deactivate' },
      '*'
    )
  }, [inspectorActive, iframeRef])

  // Inject inspector script into iframe
  const injectInspector = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentDocument) return

    // Check if already injected
    if (iframe.contentDocument.getElementById('__claude_inspector__')) return

    const script = iframe.contentDocument.createElement('script')
    script.type = 'module'
    // In dev, load from Vite dev server. In prod, load from bundled file.
    script.src = new URL('../../inspector/overlay.ts', import.meta.url).href
    iframe.contentDocument.head.appendChild(script)
  }, [iframeRef])

  return { injectInspector }
}

function pasteContextToTerminal(element: ElementContext): void {
  const { ptyId } = useTerminalStore.getState()
  if (!ptyId) return

  let contextStr = `\n# Element: <${element.tagName}>`
  if (element.componentName) contextStr += ` (${element.componentName})`
  if (element.sourceInfo) {
    contextStr += `\n# File: ${element.sourceInfo.fileName}:${element.sourceInfo.lineNumber}`
  }
  if (element.className) {
    contextStr += `\n# Classes: ${element.className}`
  }
  contextStr += '\n'

  window.api.pty.write(ptyId, contextStr)
}
```

**Step 2: Wire into CanvasPanel**

Add to CanvasPanel.tsx inside the component:
```typescript
import { useInspector } from '@/hooks/useInspector'

// Inside component:
const { injectInspector } = useInspector(iframeRef)

// On iframe load:
<iframe
  ref={iframeRef}
  src={previewUrl}
  onLoad={injectInspector}
  ...
/>
```

**Step 3: Commit**

```bash
git add src/renderer/hooks/useInspector.ts src/renderer/components/Canvas/CanvasPanel.tsx
git commit -m "feat: integrate inspector with canvas iframe and terminal context paste"
```

---

### Task 17: Render Router (Inline vs Canvas Decision)

**Files:**
- Create: `src/main/render-router.ts`
- Modify: `src/preload/index.ts`

**Step 1: Create render router**

`src/main/render-router.ts`:
```typescript
import { ipcMain, BrowserWindow, BrowserView } from 'electron'

const INLINE_MAX_WIDTH = 400
const INLINE_MAX_HEIGHT = 200

export function setupRenderRouter(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('render:evaluate', async (_event, html: string, css?: string) => {
    // Create a hidden BrowserWindow to render and measure the component
    const measureWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { offscreen: true }
    })

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>${css || ''} * { margin: 0; padding: 0; box-sizing: border-box; }</style>
        </head>
        <body>
          <div id="measure">${html}</div>
          <script>
            const el = document.getElementById('measure');
            const rect = el.getBoundingClientRect();
            document.title = JSON.stringify({
              width: Math.ceil(rect.width),
              height: Math.ceil(rect.height)
            });
          </script>
        </body>
      </html>
    `

    await measureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`)

    const title = measureWindow.getTitle()
    measureWindow.close()

    try {
      const { width, height } = JSON.parse(title)
      const target = (width <= INLINE_MAX_WIDTH && height <= INLINE_MAX_HEIGHT)
        ? 'inline'
        : 'canvas'
      return { target, width, height }
    } catch {
      return { target: 'canvas', width: 0, height: 0 }
    }
  })
}
```

**Step 2: Add to preload**

```typescript
render: {
  evaluate: (html: string, css?: string) =>
    ipcRenderer.invoke('render:evaluate', html, css)
}
```

**Step 3: Register in main**

```typescript
import { setupRenderRouter } from './render-router'

// Inside app.whenReady():
setupRenderRouter(() => mainWindow)
```

**Step 4: Commit**

```bash
git add src/main/render-router.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add render router for inline vs canvas size decision"
```

---

## Phase 5: Gallery, Timeline, Diff (Tasks 18-20)

### Task 18: Component Gallery

**Files:**
- Create: `src/renderer/components/Gallery/Gallery.tsx`
- Modify: `src/renderer/stores/gallery.ts` (new store)
- Modify: `src/renderer/components/Canvas/CanvasPanel.tsx`

This task renders component variants in isolated iframes inside the Gallery tab. Each variant gets its own sandboxed iframe with the component rendered in it.

Implementation: Create a Gallery component that accepts an array of HTML/component strings, renders each in a sandboxed iframe using `srcdoc`, and displays them in a responsive grid. Wire into the gallery tab of CanvasPanel.

**Commit message:** `feat: add component gallery with isolated iframe variant rendering`

---

### Task 19: Checkpoint Timeline

**Files:**
- Create: `src/renderer/components/CheckpointTimeline/Timeline.tsx`
- Create: `src/main/services/git.ts`
- Modify: `src/preload/index.ts`

Uses `simple-git` in the main process to create lightweight checkpoint commits. The timeline component shows a horizontal scrollable list of snapshots with timestamps. Clicking a checkpoint shows the diff.

**Commit message:** `feat: add git-based checkpoint timeline with snapshot navigation`

---

### Task 20: Diff View

**Files:**
- Create: `src/renderer/components/DiffView/DiffView.tsx`

Visual before/after comparison using two side-by-side iframes — one showing the current state, one showing a checkpoint state. Implemented as a simple split view with synchronized scroll.

**Commit message:** `feat: add visual diff view with side-by-side comparison`

---

## Phase 6: Inline Rendering System (Tasks 21-22)

### Task 21: Inline Render Component for Terminal

**Files:**
- Create: `src/renderer/components/Terminal/InlineRender.tsx`
- Modify: `src/renderer/components/Terminal/TerminalView.tsx`

This is the key innovation. Uses xterm.js's decoration API to embed sandboxed iframes directly in the terminal output. When the render router returns `target: 'inline'`, we create a decoration at the current cursor position containing a mini iframe with the rendered component.

The InlineRender component:
- Creates a sandboxed iframe using `srcdoc`
- Sizes it to the measured dimensions from the render router
- Attaches it as an xterm decoration
- Makes it interactive (clicks work, hover states work)

**Commit message:** `feat: add inline render system for small components in terminal output`

---

### Task 22: Render Router Integration

**Files:**
- Create: `src/renderer/hooks/useRenderRouter.ts`
- Modify: `src/renderer/components/Workspace/Workspace.tsx`

Creates a hook that listens for file changes via chokidar, evaluates whether changed components should render inline or in the canvas, and dispatches accordingly. Connects the render router, file watcher, terminal inline renders, and canvas panel into a unified flow.

**Commit message:** `feat: integrate render router with file watcher for adaptive rendering`

---

## Phase 7: Service Integration (Tasks 23-24)

### Task 23: OAuth Handlers (GitHub, Vercel, Supabase)

**Files:**
- Create: `src/main/oauth/github.ts`
- Create: `src/main/oauth/vercel.ts`
- Create: `src/main/oauth/supabase.ts`
- Modify: `src/preload/index.ts`

Each OAuth handler opens an external browser window for the OAuth flow, listens for the redirect callback, extracts the token, and stores it in electron-store.

**Commit message:** `feat: add OAuth handlers for GitHub, Vercel, and Supabase`

---

### Task 24: Service Status Icons

**Files:**
- Create: `src/renderer/components/ServiceIcons/ServiceIcons.tsx`
- Modify: `src/renderer/components/TitleBar/TitleBar.tsx`

Small icons in the title bar showing connection status for each service (green dot = connected, gray = disconnected). Clicking opens a dropdown to connect/disconnect.

**Commit message:** `feat: add service status icons in title bar`

---

## Phase 8: Polish (Tasks 25-27)

### Task 25: Quick Actions Bar

**Files:**
- Create: `src/renderer/components/QuickActions/QuickActions.tsx`

A command palette-style overlay (Cmd+K) with quick actions: toggle inspector, open gallery, create checkpoint, switch canvas tabs, toggle terminal, etc.

**Commit message:** `feat: add quick actions command palette`

---

### Task 26: Keyboard Shortcuts

**Files:**
- Create: `src/renderer/hooks/useKeyboardShortcuts.ts`
- Modify: `src/renderer/App.tsx`

Global keyboard shortcuts:
- `Cmd+J` — toggle terminal drawer (when in canvas-only mode)
- `Cmd+G` — open gallery tab
- `Cmd+T` — open timeline tab
- `Cmd+K` — quick actions
- `Cmd+I` — toggle inspector
- `Cmd+\` — toggle canvas panel
- `Escape` — close overlays / deactivate inspector

**Commit message:** `feat: add keyboard shortcuts for all major actions`

---

### Task 27: Animations & Visual Polish

**Files:**
- Multiple component files (add Framer Motion transitions)
- `src/renderer/styles/globals.css` (glass effects, gradients)

Add Framer Motion `layout` animations to workspace transitions, spring animations for panel open/close, glass-effect backgrounds for overlays, and smooth opacity transitions for inline renders appearing in terminal.

**Commit message:** `feat: add Framer Motion animations and visual polish`

---

## Execution Notes

**Build order matters.** Tasks 1-9 establish the core shell — do these sequentially. Tasks 10-13 (project management) can be done after the terminal works. Tasks 14-17 (canvas/inspector) depend on the workspace layout. Tasks 18-22 are the differentiating features. Tasks 23-27 are polish.

**Testing approach:** Given the heavy Electron/UI nature, prioritize:
- Unit tests for pure logic: render router size calculation, fiber walker, style extractor
- Manual testing for IPC and UI integration
- The vitest setup handles renderer-side unit tests

**Native module gotcha:** `node-pty` requires `@electron/rebuild` after any Electron version change. The `postinstall` script handles this, but verify after every `npm install`.
