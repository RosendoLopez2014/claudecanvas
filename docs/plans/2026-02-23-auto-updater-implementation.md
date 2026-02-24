# Auto-Updater Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship distributable installers (macOS DMG + zip, Windows NSIS) with automatic updates via GitHub Releases using electron-updater.

**Architecture:** electron-builder builds the installers, electron-updater checks GitHub Releases for new versions on launch + every 4 hours, downloads silently, shows a subtle status bar pill when ready. All IPC follows the existing preload bridge pattern.

**Tech Stack:** electron-builder 25, electron-updater, GitHub Actions, GitHub Releases

---

### Task 1: Install electron-updater and add build config

**Files:**
- Modify: `package.json`

**Step 1: Install electron-updater**

Run: `npm install electron-updater`

Expected: electron-updater added to `dependencies` in package.json

**Step 2: Add build config and npm scripts to package.json**

Add the `build` key and dist scripts to `package.json`:

```json
{
  "scripts": {
    "dist": "electron-vite build && electron-builder",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win"
  },
  "build": {
    "appId": "com.claudecanvas.app",
    "productName": "Claude Canvas",
    "directories": {
      "output": "dist"
    },
    "files": [
      "out/**/*",
      "resources/**/*",
      "node_modules/node-pty/**/*"
    ],
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.developer-tools",
      "identity": null
    },
    "win": {
      "target": ["nsis"]
    },
    "nsis": {
      "oneClick": true,
      "perMachine": false
    },
    "publish": {
      "provider": "github",
      "owner": "OWNER",
      "repo": "claudecanvas"
    }
  }
}
```

Note: Replace `OWNER` with the actual GitHub username/org.

**Step 3: Add `dist/` to .gitignore**

Append `dist/` to `.gitignore` so build artifacts aren't committed.

**Step 4: Verify build config is valid**

Run: `npx electron-builder --mac --dry-run`

Expected: No errors about missing config. May warn about signing (expected since `identity: null`).

**Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "feat: add electron-builder config and dist scripts"
```

---

### Task 2: Create the auto-updater module in main process

**Files:**
- Create: `src/main/updater.ts`
- Modify: `src/main/index.ts`

**Step 1: Create `src/main/updater.ts`**

```typescript
import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

export function setupAutoUpdater(win: BrowserWindow): void {
  if (process.env.NODE_ENV === 'development') return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:status', {
      status: 'available' as const,
      version: info.version
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('updater:status', {
      status: 'downloading' as const,
      percent: progress.percent
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('updater:status', {
      status: 'ready' as const,
      version: info.version
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
    // Don't send error to renderer — silent failure is fine for updates
  })

  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
```

**Step 2: Wire up IPC in `src/main/index.ts`**

Add import at top:
```typescript
import { setupAutoUpdater, installUpdate } from './updater'
```

After `createWindow()` call (~line 108), add:
```typescript
setupAutoUpdater(mainWindow!)
```

In the `app.whenReady()` block, add the IPC handler alongside the other handlers:
```typescript
ipcMain.handle('updater:install', () => installUpdate())
```

**Step 3: Commit**

```bash
git add src/main/updater.ts src/main/index.ts
git commit -m "feat: add auto-updater module with GitHub Releases provider"
```

---

### Task 3: Expose updater IPC in preload bridge

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: Add updater namespace to the api object**

Add after the `worktree` block (~line 372), before the closing `}`:

```typescript
updater: {
  onStatus: (cb: (data: {
    status: 'available' | 'downloading' | 'ready'
    version?: string
    percent?: number
  }) => void) => onIpc('updater:status', cb),
  install: () => ipcRenderer.invoke('updater:install')
}
```

**Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose updater IPC channels in preload bridge"
```

---

### Task 4: Add update notification pill to StatusBar

**Files:**
- Modify: `src/renderer/components/StatusBar/StatusBar.tsx`

**Step 1: Add updater state hook**

Inside the `StatusBar` component, add state for the update status:

```typescript
const [updateReady, setUpdateReady] = useState<string | null>(null)

useEffect(() => {
  const unsub = window.api.updater.onStatus((data) => {
    if (data.status === 'ready' && data.version) {
      setUpdateReady(data.version)
    }
  })
  return unsub
}, [])
```

**Step 2: Add the update pill in the JSX**

Place it right before the `{/* Token usage gauge */}` comment (~line 486), inside the right-side flex container:

```tsx
{updateReady && (
  <button
    onClick={() => window.api.updater.install()}
    className="flex items-center gap-1 text-[var(--accent-cyan)] hover:text-white transition-colors"
    title={`Update to v${updateReady} — click to restart`}
  >
    <ArrowDown size={10} />
    <span>v{updateReady} — Restart</span>
  </button>
)}
```

Add `ArrowDown` to the lucide-react import if not already imported (it's already imported at line 8).

**Step 3: Commit**

```bash
git add src/renderer/components/StatusBar/StatusBar.tsx
git commit -m "feat: add update notification pill to status bar"
```

---

### Task 5: Create GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create the workflow file**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx electron-builder --mac --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow for mac and windows"
```

---

### Task 6: Test the local build

**Step 1: Run a local macOS build**

Run: `npm run dist:mac`

Expected: Creates `dist/` with:
- `Claude Canvas-0.1.0.dmg`
- `Claude Canvas-0.1.0-mac.zip`
- `latest-mac.yml` (update manifest)

**Step 2: Verify the DMG mounts and app launches**

Open the DMG, drag to Applications (or run from DMG), verify the app starts.

**Step 3: Verify the app reports its version**

In the running app, check that `app.getVersion()` returns `0.1.0` (this is what electron-updater uses to compare versions).

**Step 4: Note any issues and fix**

If native modules (node-pty) fail to load in the packaged app, may need to add `asarUnpack` config:

```json
"build": {
  "asarUnpack": ["node_modules/node-pty/**/*"]
}
```

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust build config for packaged app"
```
