# Dev Server System — Test Plan

## Automated Tests

### `src/shared/__tests__/devserver-types.test.ts` — Safety Validation
- [x] `isAllowedBin` — allows npm/pnpm/yarn/bun/node/npx, rejects bash/sh/curl/wget/rm/sudo
- [x] `isCleanArg` — allows normal args, rejects shell metacharacters (;|&><$`\n)
- [x] `isCleanArg` — rejects dangerous words as standalone args (bash, sh, curl, wget, rm, sudo)
- [x] `validateCommand` — accepts valid SafeCommands, rejects invalid bin or args
- [x] `validatePlan` — validates cwd (absolute), port (1-65535), command
- [x] `parseCommandString` — parses "npm run dev", "bun dev", etc; rejects injections
- [x] `commandToString` — converts SafeCommand to display string

### `src/renderer/__tests__/dev-server-upgrade.test.ts` — Tab Store + UI
- [x] DEFAULT_DEV_STATE on new tabs
- [x] updateDevForProject broadcasts to same-path tabs
- [x] updateTabsByProject isolation across projects
- [x] Tab close cleanup
- [x] updateProjectInfo metadata updates
- [x] Dev status lifecycle transitions
- [x] Multi-project isolation
- [x] Cross-phase: full lifecycle simulation

## Manual Test Checklist

### Single Repo — Next.js
- [ ] Open a Next.js project
- [ ] Verify start button shows "Start: npm run dev" tooltip immediately
- [ ] Click Start — server starts, URL appears, canvas opens
- [ ] Stop — server stops, URL clears
- [ ] Reopen project — LastKnownGood used, same command

### Single Repo — Vite
- [ ] Open a Vite project (React + Vite)
- [ ] Verify framework detected as "vite", port 5173
- [ ] Start → Running at localhost:5173

### Monorepo with Workspaces
- [ ] Open a monorepo root
- [ ] Verify resolver finds workspace with dev script
- [ ] Start uses workspace cwd, not root

### Repo with No Dev Script
- [ ] Open a repo with only "build" and "test" scripts
- [ ] Start button opens CommandPicker
- [ ] Select a command → server starts
- [ ] "Remember" checkbox persists to LastKnownGood

### Repo with Custom Script Name
- [ ] Open a repo where dev script is named "start:dev" or "serve"
- [ ] Verify framework detection finds it
- [ ] Start uses the correct script

### Offline Mode
- [ ] Disconnect network
- [ ] Open a previously-used project
- [ ] LastKnownGood resolves without network
- [ ] Start works (no Claude verification attempted)

### Two Projects Simultaneously
- [ ] Open Project A (Next.js, port 3000)
- [ ] Start Project A — running
- [ ] Open Project B (Vite, port 5173)
- [ ] Start Project B — running independently
- [ ] Switch tabs — each shows correct status/URL
- [ ] Stop Project A — Project B still running

### Start/Stop/Restart Cycles
- [ ] Start → stop → start → stop → start (5 cycles)
- [ ] No zombie processes left (`lsof -i :3000`)
- [ ] No crash loop triggered

### Crash Recovery
- [ ] Start a project that will crash (e.g., missing dependency)
- [ ] Verify auto-install detection + retry
- [ ] Verify crash loop protection after 3 crashes
- [ ] "Clear & Retry" toast action works

### Security Validation
- [ ] Try `dev:start` with command "npm run dev; echo pwned" — rejected
- [ ] Try `devserver:setOverride` with "bash -c 'whoami'" — rejected
- [ ] Verify no `shell: true` in spawned processes (check process tree)
- [ ] Inspector postMessage uses strict origin (not *)

### MCP Tools
- [ ] `analyze_dev_server` returns correct plan
- [ ] `configure_dev_server` with valid command — sets override
- [ ] `configure_dev_server` with invalid command — rejected with error

## Log Lines to Verify
All dev server operations should produce structured logs:
```
[devserver] RESOLVE [project-name] ...
[devserver] START [project-name] ...
[devserver] READY [project-name] ...
[devserver] STOP [project-name] ...
[devserver] FAIL [project-name] ...
[devserver] CONFIG [project-name] ...
```

Logs must NEVER contain tokens, secrets, or OAuth credentials.
