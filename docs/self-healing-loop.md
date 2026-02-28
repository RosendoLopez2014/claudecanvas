# Self-Healing Dev Server Loop

> Automatic crash detection, agent-assisted code repair, process restart, and health verification — all without terminal injection.

## Overview

When a dev server crashes, the self-healing loop automatically:
1. Detects the crash and writes a diagnostic log
2. (Agent mode) Waits for Claude Code to fix the root cause via MCP tools
3. Restarts the dev server after fixes settle
4. Verifies health via HTTP probe
5. Reports progress to the UI in real-time

Two operating modes, selected by feature flag:

| Mode | Flag | Behavior |
|------|------|----------|
| **Legacy** | Default (off) | Process-level restart only: crash → backoff → restart → health check |
| **Agent** | `AGENT_REPAIR=1` | Code-level repair: crash → Claude fixes code → restart → verify |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Main Process                                │
│                                                                     │
│  runner.ts                    self-healing-loop.ts                   │
│  ┌──────────────┐             ┌────────────────────┐                │
│  │ Post-start   │──crash──▶   │ runSelfHealingLoop │                │
│  │ exit handler │  callback   │                    │                │
│  └──────────────┘             │ Legacy: backoff    │                │
│                               │ Agent: wait for    │                │
│                               │   Claude → restart │                │
│                               └────────┬───────────┘                │
│                                        │                            │
│  repair-session.ts                     │  repair-events.ts          │
│  ┌────────────────────┐                │  ┌──────────────┐          │
│  │ EventEmitter +     │◀── MCP tools ──┘  │ IPC emitter  │──────┐  │
│  │ session registry   │                   └──────────────┘      │  │
│  │ (waitForPhase /    │                                          │  │
│  │  updatePhase)      │    health-check.ts                       │  │
│  └────────────────────┘    ┌──────────────┐                      │  │
│                            │ HTTP probe   │                      │  │
│  repair-lock.ts            │ electron.net │                      │  │
│  ┌────────────────────┐    └──────────────┘                      │  │
│  │ In-memory lock     │                                          │  │
│  │ + .dev-repair.lock │                                          │  │
│  └────────────────────┘                                          │  │
│                                                                  │  │
│  MCP Tools (devserver-tools.ts)                                  │  │
│  ┌────────────────────────────────────┐                          │  │
│  │ canvas_get_repair_task()           │                          │  │
│  │   → Returns crash log, repairId,  │                          │  │
│  │     instructions, safety limits   │                          │  │
│  │                                    │                          │  │
│  │ canvas_mark_repair_step()          │                          │  │
│  │   → Claude reports progress        │                          │  │
│  │   → Fires EventEmitter → unblocks │                          │  │
│  │     self-healing loop Promise      │                          │  │
│  └────────────────────────────────────┘                          │  │
└──────────────────────────────────────────────────────────────────┤──┘
                                                                   │
                                                               IPC │
                                                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Renderer Process                             │
│                                                                     │
│  useDevRepairListener.ts         stores/devRepair.ts                │
│  ┌──────────────────────┐        ┌──────────────────┐               │
│  │ IPC listener         │──────▶ │ Zustand store    │               │
│  │ → toast notifications│        │ activeRepairs    │               │
│  └──────────────────────┘        │ recentRepairs    │               │
│                                  └────────┬─────────┘               │
│  useDevSelfHeal.ts                        │                         │
│  ┌──────────────────────┐                 ▼                         │
│  │ Crash → previewErrors│        useMcpStateExposer.ts              │
│  │ (includes repairId,  │        ┌──────────────────┐               │
│  │  logPath, hint to    │        │ __canvasState.   │               │
│  │  use repair task)    │        │ repairStatus     │               │
│  └──────────────────────┘        └──────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

## Agent Repair Flow

When `AGENT_REPAIR=1` is set:

```
1. Dev server crashes (exit code ≠ 0)
   │
2. Runner writes .dev-crash.log + calls onPostCrash callback
   │
3. Self-healing loop creates RepairSession:
   │  - Generates repairId (UUID)
   │  - Writes .dev-crash.<repairId>.log (unique crash log)
   │  - Writes .dev-repair.lock (survives app restart)
   │  - Emits: crash_detected → repair_started → awaiting_agent
   │
4. Loop blocks on waitForPhase() Promise
   │  ┌─────────────────────────────────────────────────┐
   │  │ Meanwhile, Claude Code sees crash via MCP:       │
   │  │                                                   │
   │  │ a) canvas_get_errors → sees crash error message  │
   │  │    with repairId and logPath hint                 │
   │  │                                                   │
   │  │ b) canvas_get_repair_task() → gets structured    │
   │  │    task with instructions and safety limits       │
   │  │    (calling this signals "agent_started")         │
   │  │                                                   │
   │  │ c) Claude reads crash log, diagnoses issue       │
   │  │    → marks: agent_reading_log                    │
   │  │                                                   │
   │  │ d) Claude edits source files                     │
   │  │    → marks: agent_applying_fix                   │
   │  │                                                   │
   │  │ e) Claude finishes writing                       │
   │  │    → marks: agent_wrote_files (with counts)      │
   │  │    → This resolves the Promise in step 4!        │
   │  └─────────────────────────────────────────────────┘
   │
5. Promise resolves → safety gate check:
   │  - If filesChanged > 8 or linesChanged > 300:
   │    → failed_requires_human (escalate to user)
   │  - Otherwise: proceed
   │
6. Quiet period (2s) to let watchers/HMR settle
   │
7. Restart dev server → health check
   │
8. If healthy: recovered!
   If not: loop to attempt 2 (back to step 3)
   │
9. After 3 failed attempts:
   → exhausted → cooldown (10 min) → failed_requires_human
```

### Timeout Handling

If Claude doesn't engage within 30 seconds, the loop falls through to restart anyway. This handles transient crashes (port conflict, OOM) where no code fix is needed.

## Legacy Flow

When `AGENT_REPAIR` is off (default):

```
crash → lock → exponential backoff (2s, 4s, 8s) → restart → health check
                  ↺ (up to 3 attempts)
```

This is the same process-level restart behavior that existed before.

## Phases

### Legacy Phases
| Phase | Meaning |
|-------|---------|
| `crash-detected` | Dev server crash observed |
| `lock-acquired` | Repair session started |
| `waiting` | Exponential backoff delay |
| `restarting` | Calling runner.start() |
| `health-check` | Probing the URL |
| `recovered` | Server healthy (terminal) |
| `failed` | One attempt failed, will retry |
| `exhausted` | All attempts used (terminal) |
| `aborted` | Lock held / skipped (terminal) |

### Agent Repair Phases
| Phase | Meaning |
|-------|---------|
| `crash_detected` | Crash observed, session created |
| `repair_started` | Repair session initialized |
| `awaiting_agent` | Waiting for Claude to engage |
| `agent_started` | Claude called canvas_get_repair_task |
| `agent_reading_log` | Claude reading crash log |
| `agent_applying_fix` | Claude editing source files |
| `agent_wrote_files` | Claude finished writing (triggers restart) |
| `ready_to_restart` | Quiet period before restart |
| `restarting` | Server restart in progress |
| `health-check` | Probing the URL |
| `verifying_fix` | Additional verification |
| `recovered` | Server healthy after repair (terminal) |
| `failed` | Attempt failed, will retry |
| `exhausted` | All attempts used |
| `cooldown` | 10-min cooldown period |
| `failed_requires_human` | Needs human intervention (terminal) |
| `aborted` | Skipped (concurrent repair or cooldown) |

## MCP Tools

### canvas_get_repair_task

Returns the current repair task for Claude to act on. Calling this signals agent engagement.

```json
{
  "pending": true,
  "repairId": "a1b2c3d4-...",
  "crashLogPath": ".dev-crash.a1b2c3d4.log",
  "exitCode": 1,
  "attempt": 1,
  "maxAttempts": 3,
  "phase": "awaiting_agent",
  "healthUrl": null,
  "lastEvents": [...],
  "instructions": [
    "1. Read the crash log file: .dev-crash.a1b2c3d4.log",
    "2. Identify the root cause from the error output",
    "3. Apply a minimal fix to the source code",
    "4. Call canvas_mark_repair_step with phase=\"agent_wrote_files\" when done"
  ],
  "safetyLimits": {
    "maxFiles": 8,
    "maxLinesChanged": 300,
    "noTerminalInjection": true,
    "safeMode": true
  }
}
```

### canvas_mark_repair_step

Claude reports progress on the repair. Valid phases:
- `agent_reading_log` — started reading crash log
- `agent_applying_fix` — editing source files
- `agent_wrote_files` — all fixes written (include `filesChanged` and `linesChanged`)

```json
// Request
{
  "repairId": "a1b2c3d4-...",
  "phase": "agent_wrote_files",
  "message": "Fixed missing import in App.tsx",
  "filesChanged": 1,
  "linesChanged": 3
}

// Response
{
  "ok": true,
  "phase": "agent_wrote_files",
  "nextStep": "Server will restart automatically after a brief quiet period."
}
```

### canvas_get_repair_status

Returns current repair state from the renderer store.

### canvas_get_errors

Returns preview errors (including crash errors with repairId and logPath hints).

## Safety Mechanisms

### Bounded Attempts
Default 3 attempts per repair session. After exhaustion: 10-minute cooldown, then `failed_requires_human`.

### Safety Gates
If Claude changes more than **8 files** or **~300 lines of code**, the repair is escalated to `failed_requires_human` instead of auto-restarting. This prevents runaway rewrites.

### No Terminal Injection
Claude repairs code exclusively through filesystem edits (its standard file tools) and reports progress via MCP tools. No PTY stdin injection.

### Repair Lock
- **In-memory**: `Map<string, RepairLock>` prevents concurrent repairs per project
- **File-based**: `.dev-repair.lock` written to project root, survives app restart
- **Stale detection**: On startup, checks PID in lock file — removes if process is dead

### Cooldown
After exhausting all attempts:
- 10-minute cooldown period (no auto-repair)
- User can still manually restart via the Start button
- After cooldown: marked as `failed_requires_human`

### Crash Log Correlation
Each repair session gets a unique `repairId` (UUID). Crash logs are named `.dev-crash.<repairId-prefix>.log` so multiple crashes don't overwrite each other. The generic `.dev-crash.log` is also written for backward compatibility.

### Quiet Period
After agent marks `agent_wrote_files`, the loop waits 2 seconds before restarting. This lets HMR/file watchers settle so the dev server doesn't restart mid-compilation.

## Configuration

### Feature Flag

**Environment variable** (recommended for testing):
```bash
AGENT_REPAIR=1 npm run dev
```

When off (default), the system uses legacy mode (process-level restart only).

### Constants

All in `src/shared/constants.ts`:

| Constant | Default | Description |
|----------|---------|-------------|
| `REPAIR_MAX_ATTEMPTS` | 3 | Max restart attempts per session |
| `REPAIR_BASE_DELAY_MS` | 2000 | Base delay for legacy exponential backoff |
| `REPAIR_HEALTH_TIMEOUT_MS` | 5000 | Health check timeout per probe |
| `REPAIR_HEALTH_RETRIES` | 3 | Health check retry count |
| `REPAIR_HEALTH_RETRY_DELAY_MS` | 1000 | Delay between health check retries |
| `AGENT_ENGAGE_TIMEOUT_MS` | 30000 | Time to wait for Claude to engage |
| `AGENT_WRITE_TIMEOUT_MS` | 120000 | Time to wait for Claude to finish writing |
| `REPAIR_QUIET_PERIOD_MS` | 2000 | Quiet period after file writes |
| `REPAIR_MAX_FILES` | 8 | Max files agent can change (safety gate) |
| `REPAIR_MAX_LOC` | 300 | Max LOC agent can change (safety gate) |
| `REPAIR_COOLDOWN_MS` | 600000 | Cooldown after exhaustion (10 min) |

## How to Disable

1. **Don't set AGENT_REPAIR**: The system defaults to legacy mode (process restart only)
2. **Set AGENT_REPAIR=0**: Explicitly disable agent mode

There is no way to disable the legacy self-healing loop entirely from the UI. The crash handler always fires. To fully disable, you would need to remove the `setCrashHandler` call in `src/main/devserver/index.ts`.

## Key Files

| File | Layer | Role |
|------|-------|------|
| `src/shared/devserver/repair-types.ts` | Shared | Type definitions (phases, events, task payload) |
| `src/shared/constants.ts` | Shared | Tuning constants |
| `src/main/devserver/self-healing-loop.ts` | Main | Core orchestrator (legacy + agent modes) |
| `src/main/devserver/repair-session.ts` | Main | EventEmitter-based session registry |
| `src/main/devserver/repair-lock.ts` | Main | Concurrency lock |
| `src/main/devserver/repair-events.ts` | Main | IPC event emitter |
| `src/main/devserver/health-check.ts` | Main | HTTP health probe |
| `src/main/devserver/runner.ts` | Main | Crash handler callback wiring |
| `src/main/devserver/index.ts` | Main | Wires crash handler to loop |
| `src/main/mcp/devserver-tools.ts` | Main | MCP tools (get_repair_task, mark_repair_step, etc.) |
| `src/preload/index.ts` | Preload | IPC bridge (onRepairEvent) |
| `src/renderer/stores/devRepair.ts` | Renderer | Zustand store for repair sessions |
| `src/renderer/hooks/useDevRepairListener.ts` | Renderer | IPC → store + toasts |
| `src/renderer/hooks/useDevSelfHeal.ts` | Renderer | Crash → previewErrors bridge |
| `src/renderer/hooks/useMcpStateExposer.ts` | Renderer | Exposes repairStatus on __canvasState |

## Proof of Work (Honest Progress)

Agent-related phases (`agent_started`, `agent_reading_log`, `agent_applying_fix`, `agent_wrote_files`) are only emitted when Claude explicitly calls `canvas_mark_repair_step()`. The system never fabricates agent activity — if Claude doesn't engage, the timeout path handles it as a transient crash.

## Toast Notifications

| Scenario | Toast |
|----------|-------|
| Crash detected | "Dev server crashed (exit 1)" |
| Repair started | "Repair session started — waiting for Claude Code" |
| Agent engaged | "Claude Code engaged — reading crash details" |
| Agent wrote files | "File writes complete — waiting for watchers to settle..." |
| Restart | "Restart attempt 1/3..." |
| Recovered | "Dev server recovered after agent repair!" |
| Failed | "Restart failed: [error]" |
| Exhausted | "All 3 repair attempts failed." |
| Cooldown | "Entering 10-minute cooldown period..." |
| Needs human | "All repair attempts exhausted. Manual intervention required." |

## Test Plan

### Scenario 1: Single crash → agent fixes → restart → health passes
1. Enable `AGENT_REPAIR=1`
2. Introduce a deliberate error in a project file (e.g., syntax error)
3. Start dev server → it crashes
4. Verify: crash_detected → repair_started → awaiting_agent toasts
5. Call `canvas_get_repair_task()` → verify repairId and instructions
6. Fix the file, call `canvas_mark_repair_step(repairId, 'agent_wrote_files', ...)`
7. Verify: ready_to_restart → restarting → health-check → recovered toasts

### Scenario 2: Double crash → no log confusion
1. Crash server twice quickly
2. Verify each crash gets a unique `.dev-crash.<id>.log` file
3. Verify repair session uses the correct repairId
4. Verify no stale errors from the first crash pollute the second

### Scenario 3: Repeated failures → exhausted → cooldown
1. Make a persistent error that can't be fixed
2. Let all 3 attempts exhaust
3. Verify: exhausted → cooldown → failed_requires_human sequence
4. Verify a new crash during cooldown is skipped (aborted)
5. Wait 10 minutes → verify cooldown clears

### Scenario 4: App reload mid-repair
1. Start a repair session (crash → awaiting_agent)
2. Reload the app (Cmd+R)
3. Verify: `.dev-repair.lock` file exists in project root
4. Verify: stale lock detection removes it (different PID)
5. Verify: next crash can acquire a new lock

### Scenario 5: Safety gate triggered
1. Enable `AGENT_REPAIR=1`
2. Crash server
3. Call `canvas_mark_repair_step(repairId, 'agent_wrote_files', ..., filesChanged: 20, linesChanged: 500)`
4. Verify: `failed_requires_human` with safety threshold message

### Scenario 6: Agent timeout (transient crash)
1. Enable `AGENT_REPAIR=1`
2. Crash server (transient error like port conflict)
3. Don't call any MCP tools
4. Wait 30 seconds
5. Verify: loop falls through to restart without agent
6. Verify: `ready_to_restart` message says "No agent activity"
