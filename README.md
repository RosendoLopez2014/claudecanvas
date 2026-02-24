# Claude Canvas

A terminal-first Electron development environment with adaptive rendering. Claude Code CLI runs in the embedded terminal as the primary interface, while visual output renders adaptively — small components inline in the terminal, full pages and running apps in a right-side canvas panel with an element inspector.

## Features

- **Terminal-first workflow** — Claude Code CLI is the chat interface. No separate chat panel.
- **Adaptive rendering** — Small components (< 400x200px) render inline in terminal output as interactive HTML islands. Larger components and running apps open in a resizable canvas panel.
- **Element inspector** — Click any element in the canvas preview to auto-paste component context (name, file path, styles, props) into the terminal for follow-up prompts.
- **Multi-tab workspaces** — Each tab is an isolated project with its own PTY, dev server, git state, and service connections. Tabs persist across sessions.
- **Design gallery** — Compare component variants side-by-side with annotations, pros/cons, and interactive design sessions.
- **Git integration** — Auto-checkpoints, visual diffs, branch management, push/pull with configurable workflows (solo/team/contributor modes).
- **Service integrations** — GitHub (OAuth device flow), Vercel (deploy + logs), Supabase (tables, SQL, functions, storage) — all connected via status bar icons.
- **MCP bridge** — Built-in Model Context Protocol server that Claude Code uses to render previews, manage the gallery, and control the canvas.
- **Checkpoint timeline** — Git-backed snapshots with visual before/after comparisons and one-click rollback.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- macOS, Windows, or Linux

### Install

```bash
git clone https://github.com/your-org/claude-canvas.git
cd claude-canvas
npm install
npm run rebuild   # Rebuild native modules (node-pty)
```

### Configure OAuth (optional)

Copy the environment template and fill in your OAuth credentials:

```bash
cp .env.example .env
```

Set `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`, `SUPABASE_CLIENT_ID`, and `SUPABASE_CLIENT_SECRET`. GitHub uses device flow and doesn't require client secrets. Without these, OAuth flows show a user-friendly error instead of crashing.

### Run

```bash
npm run dev       # Development with HMR
npm run build     # Production build
npm test          # Run test suite
```

### First Launch

1. Onboarding wizard guides you through theme, project directory, and optional service logins
2. Create or open a project from the project picker
3. Claude Code CLI starts automatically in the terminal
4. Start building — file changes trigger adaptive preview rendering

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Electron 33+ with electron-vite 3 |
| Frontend | React 19, Tailwind CSS 4, Framer Motion |
| Terminal | xterm.js 5 with WebGL addon |
| State | Zustand stores |
| PTY | node-pty |
| Git | simple-git |
| File watching | chokidar 4 |
| UI primitives | Radix UI |
| Split panes | allotment |
| Icons | lucide-react |
| MCP | @modelcontextprotocol/sdk |
| Testing | vitest |

## Project Structure

```
src/
├── main/              # Main process (Node.js)
│   ├── index.ts       # App entry, window creation, IPC setup
│   ├── pty.ts         # PTY management (node-pty)
│   ├── watcher.ts     # File watching (chokidar)
│   ├── inspector.ts   # Canvas element inspector injection
│   ├── store.ts       # electron-store settings
│   ├── validate.ts    # Shared path validation
│   ├── devserver/     # Dev server lifecycle management
│   ├── mcp/           # MCP bridge (server, tools, config)
│   ├── oauth/         # GitHub, Vercel, Supabase OAuth
│   └── services/      # Git, templates, search, secure storage
├── preload/           # Typed IPC bridge (contextBridge)
│   └── index.ts       # All renderer↔main communication
├── renderer/          # React 19 UI
│   ├── App.tsx        # Root component, screen routing
│   ├── components/    # UI components (Canvas, Terminal, Gallery, etc.)
│   ├── hooks/         # Custom hooks (usePty, useInspector, etc.)
│   ├── stores/        # Zustand stores (tabs, gallery, project, etc.)
│   └── services/      # Terminal pool management
├── inspector/         # Scripts injected into canvas iframe
│   ├── overlay.ts     # Element highlight/selection
│   ├── fiber-walker.ts # React fiber → source mapping
│   └── style-extractor.ts
└── shared/            # Constants shared across all processes
    └── constants.ts
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — Process model, state management, data flows
- [Development Guide](docs/DEVELOPMENT.md) — Setup, project structure, patterns, testing
- [Security](docs/SECURITY.md) — Token storage, IPC isolation, inspector sandboxing
- [IPC Reference](docs/IPC-REFERENCE.md) — Complete preload bridge API
- [Upgrade Notes](UPGRADE_NOTES.md) — Security audit changelog

## License

Private — All rights reserved.
