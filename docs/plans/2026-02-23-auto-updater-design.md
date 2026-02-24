# Auto-Updater via GitHub Releases — Design

**Date:** 2026-02-23
**Status:** Approved

## Goal

Ship distributable installers (macOS DMG, Windows NSIS) with automatic updates via GitHub Releases using electron-updater.

## Decisions

- **Approach:** electron-updater + GitHub Releases provider (Approach A)
- **Platforms:** macOS (DMG + zip) and Windows (NSIS)
- **Code signing:** Skipped for now (`identity: null` on macOS)
- **Update check:** On launch + every 4 hours
- **UI:** Silent background download, subtle status bar pill when ready

## Build Configuration

Add `build` key to `package.json`:

```json
{
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
      "owner": "<github-username>",
      "repo": "claudecanvas"
    }
  }
}
```

## Auto-Updater Module

New file: `src/main/updater.ts`

- Skips update checks in dev mode
- `autoDownload: true`, `autoInstallOnAppQuit: true`
- Emits `updater:status` events to renderer: `available`, `downloading`, `ready`, `error`
- Listens for `updater:install` IPC to call `quitAndInstall()`
- Checks on launch, then every 4 hours via `setInterval`

## Preload Bridge

Two new channels on the context bridge:
- `onUpdaterStatus(callback)` — receives status events from main
- `installUpdate()` — triggers quit-and-install

## Renderer UI

Minimal status bar integration:
- Hidden by default
- Shows cyan pill "v{version} ready — Restart" when update downloaded
- Click triggers `installUpdate()`
- No modal, no blocking, no progress bar

## GitHub Actions CI

File: `.github/workflows/release.yml`

Triggered on tag push (`v*`):
- `build-mac` job: `macos-latest`, builds DMG + zip, publishes to GitHub Releases
- `build-win` job: `windows-latest`, builds NSIS, publishes to GitHub Releases
- Uses `GITHUB_TOKEN` (automatic, no secrets needed)

## Release Flow

1. Bump version in `package.json`
2. Commit: `git commit -m "release: vX.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push && git push --tags`
5. CI builds both platforms, uploads to GitHub Release
6. Running apps auto-detect within 4 hours or on next launch

## npm Scripts

```json
"dist": "electron-vite build && electron-builder",
"dist:mac": "electron-vite build && electron-builder --mac",
"dist:win": "electron-vite build && electron-builder --win"
```
