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
