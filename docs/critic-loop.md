# Critic Loop — Technical Reference

Two-model review system where Claude Code (Implementer) runs in the embedded terminal while an OpenAI model (Critic) reviews plans before code and results after code, driving iterative polish.

---

## Table of Contents

1. [Concept](#concept)
2. [How the Models Communicate](#how-the-models-communicate)
3. [Architecture Overview](#architecture-overview)
4. [State Machine](#state-machine)
5. [Event Flows](#event-flows)
6. [UI Actions Reference](#ui-actions-reference)
7. [Plan Detection](#plan-detection)
8. [OpenAI Critic Service](#openai-critic-service)
9. [Automation Modes](#automation-modes)
10. [Artifact Storage](#artifact-storage)
11. [Security](#security)
12. [IPC Reference](#ipc-reference)
13. [File Map](#file-map)
14. [Future Vision](#future-vision)

---

## Concept

Claude Canvas is a terminal-first IDE where Claude Code CLI is the primary AI. The Critic Loop adds a second AI (OpenAI) that acts as a code reviewer, creating a feedback loop:

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Canvas                          │
│                                                             │
│  ┌──────────────┐    plan text     ┌──────────────────┐     │
│  │              │ ───────────────► │                  │     │
│  │   Claude     │                  │  OpenAI Critic   │     │
│  │  (Terminal)  │ ◄─────────────── │  (Background)    │     │
│  │              │  JSON feedback   │                  │     │
│  └──────────────┘                  └──────────────────┘     │
│        ▲                                    ▲               │
│        │ reads/writes                       │ API calls     │
│        │ terminal text                      │ + JSON mode   │
│        ▼                                    ▼               │
│  ┌──────────────┐                  ┌──────────────────┐     │
│  │  PTY (stdin/ │                  │  Main Process    │     │
│  │    stdout)   │                  │  Critic Engine   │     │
│  └──────────────┘                  └──────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

Two review checkpoints:

1. **Plan Review** — When Claude proposes a plan, the critic evaluates it for correctness, completeness, risks, and missing edge cases before coding begins.

2. **Result Review** — After Claude finishes coding, the app packages git diffs + diagnostics (tsc errors, test output) and sends them to the critic for bug, security, and quality feedback.

---

## How the Models Communicate

The two models never talk to each other directly. The app mediates all communication through distinct channels.

### Signaling Claude (Implementer)

Claude runs as a CLI process in a PTY (pseudo-terminal). It has no special API — all communication is plain text through stdin/stdout.

**Receiving feedback:** The app writes formatted text to Claude's stdin via `window.api.pty.write(ptyId, text)`. Claude sees this as terminal input:

```
[CRITIC FEEDBACK - Plan Review]
Verdict: REVISE

Summary: The plan misses error handling for the database connection.

Issues (2):
1. [CRITICAL] No error handling for database connection failure
   File: src/db.ts
   Recommendation: Add try-catch with retry logic
2. [MINOR] Missing input validation on user email
   File: src/routes/auth.ts
   Recommendation: Add zod schema validation

Please address the issues above and continue.
```

**How Claude knows about the critic:** The app injects a "Critic Loop" section into each project's `CLAUDE.md` (via `config-writer.ts`). This tells Claude:
- What `[CRITIC FEEDBACK]` blocks mean
- How to respond to each verdict (`approve`, `revise`, `reject`)
- Not to argue with the critic — fix issues or explain to the user

**Detecting Claude's plans:** The app passively monitors Claude's stdout via the PTY data listener system. When Claude writes a plan, the plan detector extracts it from terminal output (see [Plan Detection](#plan-detection)).

### Signaling OpenAI (Critic)

The critic is called via the OpenAI Chat Completions API with `response_format: { type: 'json_object' }`.

**Request format:** System prompt + user content as chat messages.

| Review Type | System Prompt | User Content |
|---|---|---|
| Plan Review | "You are a strict code plan reviewer..." | Project context + proposed plan text |
| Result Review | "You are a strict code reviewer..." | Project context + original plan + git diff (secrets redacted) + tsc output + test output |

**Response format:** Structured JSON validated by a Zod schema:

```json
{
  "verdict": "revise",
  "summary": "The implementation has a SQL injection vulnerability.",
  "issues": [
    {
      "severity": "critical",
      "description": "User input is concatenated directly into SQL query",
      "file": "src/db/queries.ts",
      "recommendation": "Use parameterized queries"
    }
  ],
  "strengths": ["Good test coverage", "Clean separation of concerns"],
  "score": 45
}
```

**Temperature:** 0.2 (deterministic, focused).

**Retry logic:** If the response fails JSON parsing, one retry is sent with a correction hint appended.

---

## Architecture Overview

```
Renderer (React)                    Main Process (Node.js)
─────────────────                   ──────────────────────

App.tsx                             index.ts
  ├─ useCriticListener()              └─ setupCriticHandlers()
  │    ├─ critic:event → store              ├─ IPC handlers (14 channels)
  │    ├─ critic:planDetected → store       ├─ setupPlanDetector()
  │    ├─ auto-review logic                 │
  │    └─ auto-send logic                   │
  │                                         │
  ├─ useCriticPtyRegistration()             │
  │    └─ registerPty/unregisterPty ────►   │
  │                                         │
  └─ CriticPanel (canvas tab)              critic/
       ├─ CriticSetupPrompt                  ├─ engine.ts (state machine)
       ├─ CriticSettings                     ├─ plan-detector.ts (PTY tap)
       ├─ PlanPreview                        ├─ events.ts (IPC emitter)
       ├─ FeedbackCard                       ├─ artifact-store.ts (disk)
       ├─ EventTimeline                      ├─ config-store.ts (electron-store)
       └─ StatusBar CriticChip              ├─ diagnostics.ts (tsc/test runner)
                                            └─ index.ts (IPC barrel)
stores/
  └─ critic.ts (Zustand)                   services/
       ├─ activeSessions                     ├─ openai.ts (API + retry + redact)
       ├─ recentSessions                     └─ secure-storage.ts (API key)
       └─ pendingPlans
                                           pty.ts
                                             └─ externalDataListeners (tap)

shared/
  └─ critic/
       ├─ types.ts (CriticPhase, CriticFeedback, ...)
       └─ format.ts (formatFeedbackForClaude)
```

### Process Boundaries

| Layer | Responsibility |
|---|---|
| **Renderer** | UI, user interactions, Zustand store, automation triggers |
| **Preload** | Typed IPC bridge (`window.api.critic.*`), context isolation |
| **Main** | OpenAI API calls, PTY monitoring, artifact persistence, secure storage |
| **Shared** | Types, constants, feedback formatter |

All cross-process communication uses Electron IPC through the preload bridge. The renderer never has direct access to the OpenAI API key or the file system.

---

## State Machine

A critic run progresses through these phases:

```
                     ┌──────────────────────────────────────┐
                     │              idle                     │
                     └──────────┬───────────────────────────┘
                                │ plan detected in PTY output
                     ┌──────────▼───────────────────────────┐
                     │         plan_detected                 │
                     └──────────┬───────────────────────────┘
                                │ user clicks "Review Plan"
                                │ OR autoReviewPlan triggers
                     ┌──────────▼───────────────────────────┐
                     │    critic_reviewing_plan              │ ← OpenAI API call
                     └────────┬─────────────────┬───────────┘
                              │ success         │ API error
                     ┌────────▼────────┐   ┌────▼──────────┐
                     │ plan_feedback    │   │    error       │ (terminal)
                     │    _ready        │   └───────────────┘
                     └────────┬────────┘
                              │ feedback sent to Claude
                              │ Claude implements the plan
                     ┌────────▼───────────────────────────────┐
                     │            executing                    │
                     └────────┬───────────────────────────────┘
                              │ user clicks "Run Code Review"
                     ┌────────▼───────────────────────────────┐
                     │         post_review_prep                │
                     └────────┬───────────────────────────────┘
                              │ diagnostics + diff collected
                     ┌────────▼───────────────────────────────┐
                     │      critic_reviewing_result            │ ← OpenAI API call
                     └────────┬─────────────────┬─────────────┘
                              │ success         │ API error
                     ┌────────▼────────┐   ┌────▼──────────┐
                     │ result_feedback  │   │    error       │ (terminal)
                     │    _ready        │   └───────────────┘
                     └────────┬────────┘
                              │
                ┌─────────────┼──────────────┐
                │ approve     │ revise       │ reject
           ┌────▼────┐   ┌───▼─────┐   ┌────▼─────────┐
           │  done    │   │ loop:   │   │ result_      │
           │(terminal)│   │ Claude  │   │ feedback_    │
           └─────────┘   │ fixes → │   │ ready        │
                          │ next    │   │ (user        │
                          │ review  │   │  decides)    │
                          └─────────┘   └──────────────┘
                          (iteration < maxIterations)
                          else → done (terminal)
```

**Terminal phases** (`done`, `aborted`, `error`): When a session enters one of these, it moves from `activeSessions` to `recentSessions` in the Zustand store (keeping the last 5).

---

## Event Flows

### Flow A: Plan Review (Manual)

```
 Step  Who             What Happens
 ────  ──────────────  ──────────────────────────────────────────
  1    Claude          Outputs plan text to terminal stdout
  2    PTY onData      Broadcasts raw bytes to external listeners
  3    Plan Detector   Appends to rolling buffer, debounces 2s
  4    Plan Detector   Strips ANSI, runs extractPlan(), scores confidence
  5    Plan Detector   If confidence ≥ 0.4 and not in 15s cooldown:
                       sends 'critic:planDetected' IPC to renderer
  6    useCriticListener  Receives event, calls store.setPendingPlan()
  7    CriticPanel     Shows PlanPreview card with plan text + confidence
  8    User            Clicks "Review Plan" button
  9    CriticPanel     Calls window.api.critic.reviewPlan()
 10    Engine          Creates run artifact, emits 'critic_reviewing_plan'
 11    Engine          Calls openai.reviewPlan() → OpenAI API
 12    OpenAI          Returns structured JSON feedback
 13    Engine          Validates with Zod, saves artifact, emits
                       'plan_feedback_ready' with feedback payload
 14    useCriticListener  Receives event, calls store.pushEvent()
 15    CriticPanel     Shows FeedbackCard with verdict/issues/strengths
 16    User            Clicks "Send to Claude" button
 17    CriticPanel     Formats feedback → writes to PTY stdin
 18    Claude          Reads [CRITIC FEEDBACK], addresses issues
```

### Flow B: Code Review (Manual)

```
 Step  Who             What Happens
 ────  ──────────────  ──────────────────────────────────────────
  1    User            Clicks "Run Code Review" in CriticPanel
  2    CriticPanel     Fires two parallel requests:
                       - window.api.critic.collectDiagnostics()
                       - window.api.git.diff()
  3    Diagnostics     Spawns: npx tsc --noEmit (30s timeout)
                       Spawns: npm test (60s timeout, if test script exists)
  4    CriticPanel     Sends diff + diagnostics via
                       window.api.critic.reviewResult()
  5    Engine          Increments iteration counter
  6    Engine          If iteration > maxIterations → done
  7    Engine          Redacts secrets from diff, truncates to 100K
  8    Engine          Calls openai.reviewResult() → OpenAI API
  9    OpenAI          Returns structured JSON feedback
 10    Engine          If approve → emits 'done'
                       If revise/reject → emits 'result_feedback_ready'
 11    CriticPanel     Shows FeedbackCard
 12    User            Clicks "Send to Claude"
 13    Claude          Reads feedback, makes fixes
 14                    → User may trigger another code review (iteration loop)
```

### Flow C: Fully Automated Loop

```
 Step  Who              What Happens
 ────  ───────────────  ──────────────────────────────────────────
  1    Claude           Outputs plan
  2    Plan Detector    Detects plan, emits planDetected
  3    useCriticListener  autoReviewPlan=true → auto-calls reviewPlan()
  4    Engine           Reviews plan via OpenAI
  5    useCriticListener  autoSendFeedback=true → auto-writes feedback
                         to Claude's terminal via pty.write()
  6    Claude           Reads feedback, revises plan, implements
  7    User             Clicks "Run Code Review" (still manual)
  8    Engine           Reviews result via OpenAI
  9    useCriticListener  autoSendFeedback=true → auto-writes feedback
 10    Claude           Reads feedback, fixes issues
 11                     → Loop continues until approve or maxIterations
```

---

## UI Actions Reference

### Critic Panel (Canvas Tab)

The Critic Panel is the 7th canvas tab, accessible by clicking "Critic" in the canvas tab bar.

#### Setup Prompt
- **Shown when:** No OpenAI API key is configured
- **Action:** User enters `sk-...` key → encrypted via OS keychain → stored in electron-store
- **Result:** Key saved, panel shows settings + content

#### Settings (Expandable)

| Setting | Control | Default | Description |
|---|---|---|---|
| Enable critic loop | Checkbox | Off | Master switch — plan detection only runs when enabled |
| Model | Dropdown | GPT-5.2 | OpenAI model for reviews. Options: GPT-5.2, GPT-5.2 Pro, GPT-5, GPT-5 Mini, GPT-5 Nano, o3, o3 Pro, o4 Mini, o3 Mini, GPT-4.1 |
| Max iterations | Number (1-10) | 3 | How many result review rounds before auto-stopping |
| Auto-review detected plans | Checkbox | Off | Send plans to critic automatically when detected |
| Auto-send feedback to Claude | Checkbox | Off | Write feedback to terminal without manual click |
| API key status | Indicator | — | Shows "configured" (green) or "not set" (red), with delete button |

#### Plan Preview Card
- **Shown when:** A plan is detected in Claude's output
- **Displays:** Plan text (first 1000 chars), confidence percentage
- **Actions:**
  - **Review Plan** — Sends plan to OpenAI for review. Shows spinner during API call.
  - **Dismiss** — Removes the card without reviewing. Shows "Proceeding without review" warning.

#### Feedback Card
- **Shown when:** Plan or result feedback arrives from OpenAI
- **Displays:**
  - Verdict badge (Approved/green, Revise/yellow, Rejected/red)
  - Score (0-100, if provided)
  - Summary text
  - Expandable issues list with severity icons and colors
  - Strengths list
- **Actions:**
  - **Send to Claude** — Formats feedback as text, writes to Claude's terminal stdin

#### Run Code Review Button
- **Always visible** in the action bar
- **Tooltip:** "Reviews uncommitted changes via git diff + tsc + tests"
- **What it does:**
  1. Collects diagnostics (tsc + tests) from the project
  2. Gets git diff of uncommitted changes
  3. If everything is empty → shows "Nothing to review" error
  4. Otherwise sends to OpenAI for review
- **Disabled when:** Already running a review

#### Abort Button
- **Shown when:** An active session exists
- **What it does:** Sets phase to `aborted`, clears the run

#### Event Timeline
- **Shown when:** A session has events
- **Displays:** Timestamped log of all phase transitions and messages

### StatusBar Critic Chip

Small indicator in the bottom status bar, always visible when critic is active.

| State | Display | Click Action |
|---|---|---|
| Reviewing | Spinning loader + "Reviewing..." | Opens popover |
| Plan detected | Purple dot + "Plan detected" | Opens popover |
| Feedback ready | Purple dot + "Feedback" | Opens popover |
| Idle (has session) | Dim "Critic" text | Opens popover |
| Never used | Hidden | — |

**Popover contents:**
- Plan verdict with "Send to Claude" button
- Code verdict with "Send to Claude" button
- Pending plan confidence
- "Open Critic Panel" link (switches canvas tab)

---

## Plan Detection

Plan detection runs in the main process, tapping into raw PTY output without modifying the terminal rendering pipeline.

### How it Works

1. **PTY data listener registry** (`src/main/pty.ts`): A `Set<PtyDataListener>` that any module can subscribe to. Every byte of PTY output is broadcast to all listeners.

2. **Registration**: When a tab mounts in the renderer, `useCriticPtyRegistration` calls `critic:registerPty(ptyId, tabId, projectPath)`, which maps the PTY to its tab for event routing.

3. **Rolling buffer**: Each registered PTY has a rolling text buffer capped at 50,000 chars. New data is appended; old data falls off the front.

4. **Debounce**: After each data chunk, a 2-second debounce timer resets. When it fires:
   - Strip ALL ANSI escape sequences (CSI, OSC, single-char escapes, carriage returns)
   - Scan lines for plan keywords (case-insensitive)
   - If found, extract plan text until a stop boundary
   - Compute confidence score

5. **Confidence scoring**: Heuristic based on structural signals:

   | Signal | Score |
   |---|---|
   | 8+ lines | +0.3 |
   | Numbered steps (`1.` or `1)`) | +0.2 |
   | Bullet points (`-` or `*`) | +0.1 |
   | Markdown headings (`#`) | +0.2 |
   | 15+ lines | +0.2 |
   | Maximum | 1.0 |
   | Minimum to emit | 0.4 |

6. **Cooldown dedup**: Same plan (by hash) won't be re-emitted within 15 seconds. Buffer is cleared after emitting so the next scan starts fresh.

### Default Keywords

```
'plan:', 'implementation plan', 'approach:', 'steps:',
"here's what i'll do", 'i will:', 'strategy:'
```

### Stop Boundaries

Plan extraction stops when it hits:
- Code fence opening (`` ```language ``)
- "I'll now implement"
- "Executing..."
- "I'll start by"
- "Let me start/begin"

### Minimum Length

Plans shorter than 50 characters are discarded (too noisy).

---

## OpenAI Critic Service

### API Configuration

| Parameter | Value |
|---|---|
| Response format | `{ type: 'json_object' }` |
| Temperature | 0.2 |
| Timeout | 60 seconds |
| JSON retry count | 1 |
| Max diff size | 100,000 chars |

### System Prompts

**Plan review:**
> You are a strict code plan reviewer. Analyze for correctness, completeness, risks, missing edge cases. Return ONLY valid JSON: { "verdict": "approve"|"revise"|"reject", "summary": "1-2 sentences", "issues": [...], "strengths": ["optional"], "score": 0-100 }. Be concise, actionable.

**Result review:**
> You are a strict code reviewer. Review an implementation (diff + diagnostics) for bugs, missing tests, security issues, code quality. Return ONLY valid JSON: { "verdict": "approve"|"revise"|"reject", "summary": "1-2 sentences", "issues": [...], "strengths": ["optional"], "score": 0-100 }. Be concise, actionable. Never include sensitive data.

### Response Schema (Zod)

```typescript
{
  verdict: z.enum(['approve', 'revise', 'reject']),
  summary: z.string(),
  issues: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
    description: z.string(),
    file: z.string().optional(),
    recommendation: z.string().optional(),
  })),
  strengths: z.array(z.string()).optional(),
  score: z.number().min(0).max(100).optional(),
}
```

### Error Handling

- **Invalid JSON**: Retries once with a correction hint appended to messages
- **Model not found**: Throws immediately with "Model not available — change it in Critic settings"
- **Timeout**: 60-second hard limit
- **Logging**: Error messages truncated to 200 chars (redacted)

---

## Automation Modes

Three progressive levels of automation:

### Stage 1: Fully Manual (Default)

Both toggles off. User manually:
1. Clicks "Review Plan" when a plan is detected
2. Clicks "Send to Claude" when feedback arrives
3. Clicks "Run Code Review" after Claude codes

### Stage 2: Auto-Review Plans

`autoReviewPlan = true`, `autoSendFeedback = false`.

When a plan is detected:
- `useCriticListener` auto-calls `reviewPlan()` immediately
- Pending plan UI is dismissed (no need to click)
- User still manually clicks "Send to Claude" for feedback

### Stage 3: Fully Automated Loop

Both toggles on: `autoReviewPlan = true`, `autoSendFeedback = true`.

```
Claude outputs plan
       │
       ▼ (auto-detected)
Critic reviews plan (auto-triggered)
       │
       ▼ (auto-sent to terminal)
Claude reads feedback, revises, implements
       │
       ▼ (user clicks "Run Code Review")
Critic reviews code (auto-sent results)
       │
       ▼ (auto-sent to terminal)
Claude reads feedback, fixes issues
       │
       └──► Loop until approve or maxIterations
```

**Note:** "Run Code Review" is still user-triggered even in Stage 3, because the app can't reliably detect when Claude has finished coding. This is a deliberate design choice — the user decides when the code is ready for review.

---

## Artifact Storage

Each critic run persists artifacts to disk for history and debugging:

```
<projectPath>/
  .claude-wrapper/
    .gitignore          ← contains '*' (never tracked)
    runs/
      <runId>/
        manifest.json   ← full CriticRunArtifact
        plan.md         ← raw plan text
        diff.patch      ← git diff at review time
        plan-feedback.json    ← CriticFeedback for plan
        result-feedback.json  ← CriticFeedback for result
```

- **Run IDs** are 8-character UUID prefixes (e.g., `b73515d5`)
- **Atomic writes**: All files are written to a `.tmp.XXXXXX` path first, then renamed — prevents partial writes on crash
- **`.claude-wrapper/.gitignore`** contains `*` — the entire directory is excluded from git. The app never modifies the project's root `.gitignore`.

---

## Security

### API Key Storage

The OpenAI API key is encrypted using Electron's `safeStorage` API:
- **macOS:** Keychain
- **Windows:** DPAPI
- **Linux:** libsecret

The encrypted blob is stored in `electron-store` under the key `critic_openai`. The raw key only exists in memory in the main process during API calls. It is never:
- Sent via IPC to the renderer
- Written to disk in plaintext
- Logged to console
- Included in artifact files

### Secret Redaction

Before sending diffs and diagnostics to OpenAI, the app scans for lines matching secret patterns and replaces them:

```
Patterns matched:
  OPENAI_API_KEY=...  →  [REDACTED — secret line removed]
  API_KEY: ...        →  [REDACTED — secret line removed]
  "password": "..."   →  [REDACTED — secret line removed]
  SECRET_KEY=...      →  [REDACTED — secret line removed]
  TOKEN=...           →  [REDACTED — secret line removed]
  PRIVATE_KEY=...     →  [REDACTED — secret line removed]
```

### Concurrency Guards

The engine uses an `inFlightReviews: Set<string>` guard to prevent concurrent reviews on the same tab. If a review is already in progress, the second call throws immediately.

---

## IPC Reference

### Main → Renderer (Push Events)

| Channel | Payload | Emitted By | Purpose |
|---|---|---|---|
| `critic:event` | `CriticEvent` | `events.ts` | All phase transitions, feedback delivery |
| `critic:planDetected` | `PlanDetectedEvent` | `plan-detector.ts` | Plan found in terminal output |

### Renderer → Main (Request-Response)

| Channel | Parameters | Returns | Purpose |
|---|---|---|---|
| `critic:getConfig` | `projectPath` | `CriticConfig` | Read config |
| `critic:setConfig` | `projectPath, config` | `{ ok }` | Write config |
| `critic:hasApiKey` | — | `boolean` | Check if key exists |
| `critic:setApiKey` | `key` | `{ ok }` | Store/delete key |
| `critic:reviewPlan` | `tabId, projectPath, planText, ctx` | `CriticFeedback \| { error }` | Trigger plan review |
| `critic:reviewResult` | `tabId, projectPath, diff, diag, ctx` | `CriticFeedback \| { error }` | Trigger result review |
| `critic:getActiveRun` | `tabId` | `CriticRunArtifact \| null` | Query active run |
| `critic:abort` | `tabId` | `{ ok }` | Abort a run |
| `critic:complete` | `tabId` | `{ ok }` | Mark run done |
| `critic:collectDiagnostics` | `projectPath` | `CriticDiagnostics` | Run tsc + tests |
| `critic:listRuns` | `projectPath` | `string[]` | List run IDs |
| `critic:loadRun` | `projectPath, runId` | `CriticRunArtifact \| null` | Load historic run |

### Renderer → Main (Fire-and-Forget)

| Channel | Parameters | Purpose |
|---|---|---|
| `critic:registerPty` | `ptyId, tabId, projectPath` | Start monitoring PTY for plans |
| `critic:unregisterPty` | `ptyId` | Stop monitoring PTY |

---

## File Map

### Main Process

| File | Purpose |
|---|---|
| `src/main/critic/engine.ts` | State machine, run lifecycle, OpenAI coordination |
| `src/main/critic/plan-detector.ts` | PTY tap, ANSI stripping, keyword matching, confidence scoring |
| `src/main/critic/events.ts` | Console logging + IPC event emission |
| `src/main/critic/artifact-store.ts` | Disk persistence (atomic writes) |
| `src/main/critic/config-store.ts` | Per-project config in electron-store |
| `src/main/critic/diagnostics.ts` | Spawns tsc and npm test, collects output |
| `src/main/critic/index.ts` | IPC handler barrel (14 channels) |
| `src/main/services/openai.ts` | OpenAI API wrapper, JSON mode, retry, secret redaction |
| `src/main/services/secure-storage.ts` | Encrypted API key storage (`critic_openai` provider) |
| `src/main/pty.ts` | External data listener registry (plan detector taps here) |
| `src/main/mcp/config-writer.ts` | Injects "Critic Loop" section into project CLAUDE.md |
| `src/main/index.ts` | Calls `setupCriticHandlers()` on app ready |

### Shared

| File | Purpose |
|---|---|
| `src/shared/critic/types.ts` | All TypeScript types and defaults |
| `src/shared/critic/format.ts` | `formatFeedbackForClaude()` — text formatter |
| `src/shared/constants.ts` | Timing/size constants |

### Renderer

| File | Purpose |
|---|---|
| `src/renderer/stores/critic.ts` | Zustand store (sessions, pending plans) |
| `src/renderer/hooks/useCriticListener.ts` | IPC bridge + automation logic |
| `src/renderer/hooks/useCriticPtyRegistration.ts` | PTY registration on tab mount |
| `src/renderer/components/Canvas/CriticPanel.tsx` | Full critic UI (settings, preview, feedback, timeline) |
| `src/renderer/components/StatusBar/StatusBar.tsx` | CriticChip + popover |
| `src/renderer/hooks/useMcpStateExposer.ts` | Exposes critic status to MCP tools |
| `src/renderer/App.tsx` | Mounts useCriticListener + useCriticPtyRegistration |
| `src/renderer/types/canvas.ts` | `'critic'` in CanvasTab union |
| `src/renderer/components/Canvas/CanvasPanel.tsx` | Renders CriticPanel when tab is active |

---

## Future Vision

### What Works Today

- Plan detection via PTY monitoring with keyword matching and confidence scoring
- Manual plan review and code review with feedback cards
- Send feedback to Claude as formatted terminal text
- Auto-review plans (Stage 2 automation)
- Auto-send feedback (Stage 3 automation)
- Per-tab isolation (two tabs on same project get independent runs)
- Artifact persistence for history and debugging
- Encrypted API key storage
- Secret redaction before sending to OpenAI
- StatusBar chip with at-a-glance status

### Where We Want to Go

#### Auto-Trigger Code Review

Today, "Run Code Review" is always user-triggered. Future: detect when Claude has finished implementing (e.g., Claude says "Done" or the terminal returns to a prompt) and auto-trigger code review. This would close the loop fully:

```
Plan detected → auto-review → auto-send feedback →
Claude codes → auto-detect completion → auto-code-review →
auto-send feedback → Claude fixes → loop until approve
```

#### Smarter Plan Detection

- Use a lightweight local model (or heuristic improvements) to better distinguish plans from general text
- Detect plan revisions (Claude rewrites plan after feedback) as updates rather than new plans
- Support multi-turn plans where Claude builds the plan across several messages

#### Multi-Provider Critic

- Support Anthropic Claude as the critic (not just OpenAI)
- Support local models (Ollama, llama.cpp) for air-gapped environments
- Provider selector in settings alongside model selector

#### Iteration History and Analytics

- Show all iterations of a run side-by-side (plan v1, feedback, plan v2, feedback, ...)
- Track metrics over time: average score, common issue categories, iteration count trends
- Export run history for team review

#### Claude-Initiated Reviews

Today, Claude doesn't know when a review is happening — it just receives feedback. Future: expose critic controls as MCP tools so Claude can:
- Request a plan review before it starts coding
- Request a code review when it thinks it's done
- Read previous feedback to avoid repeating mistakes

#### Project-Level Rules

- Custom system prompt additions per project ("This is a React app, check for hook violations")
- Banned patterns ("Never use `any` type")
- Required patterns ("All API routes must have error handling")
- These get appended to the OpenAI system prompt

#### Real-Time Streaming Review

- Stream OpenAI's response token-by-token into the feedback card
- Show partial feedback immediately instead of waiting for the full response
- Use streaming to show a "thinking" indicator with partial results
