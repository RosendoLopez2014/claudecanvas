# Boot Overlay — "Mission Control" Loading Screen

**Date:** 2026-02-17
**Status:** Approved

## Problem

When a user selects a project, the transition to the workspace is jarring:
1. Blank dark rectangle appears (~50ms while xterm mounts)
2. Cyan welcome box renders (writeWelcomeBanner)
3. Terminal resets and redraws the box (to clear shell init noise)
4. Dead time while waiting for MCP + Claude CLI boot
5. Claude finally appears

This feels unpolished — flashing, double-drawing, and no indication of what's happening.

## Solution

A full-screen **BootOverlay** component that sits on top of the Workspace. The terminal mounts and boots normally behind it. The overlay shows real progress tied to actual system events. When all steps complete, the overlay performs a cinematic exit animation revealing the live terminal with Claude already running.

## Architecture

```
┌─ App.tsx ─────────────────────────────────────────────┐
│  <TitleBar />                                          │
│  <TabBar />  (visible immediately)                     │
│  ┌─ content area (relative) ─────────────────────────┐ │
│  │  <Workspace />  (mounts immediately, boots PTY)   │ │
│  │                                                    │ │
│  │  ┌─ BootOverlay (absolute, z-20) ────────────────┐│ │
│  │  │  Logo + project name                           ││ │
│  │  │  Step checklist (real progress)                ││ │
│  │  │  Progress bar                                  ││ │
│  │  │  Feature tags (staggered animation)            ││ │
│  │  └────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────┘ │
│  <StatusBar />  (visible immediately)                  │
└────────────────────────────────────────────────────────┘
```

## Progress Steps

| Step | Label | Triggered by | Weight |
|------|-------|-------------|--------|
| 1 | Spawning terminal | PTY ID assigned after `pty.spawn()` | 25% |
| 2 | MCP bridge | `mcpReady` set to true in project store | 25% |
| 3 | Claude Code | Claude CLI output detected in PTY stream | 40% |
| 4 | Ready | All above done + 400ms settle delay | 10% |

Progress bar fills smoothly between steps (CSS transition), not jumping.

## Event Plumbing

Add a `boot` field to `TabState` in `stores/tabs.ts`:

```ts
boot: {
  ptyReady: boolean
  mcpReady: boolean
  claudeReady: boolean
}
```

Sources:
- `ptyReady`: set in `usePty.connect()` after `pty.spawn()` resolves
- `mcpReady`: set in `App.tsx` MCP ready handler (already exists)
- `claudeReady`: set in `usePty.ts` `onData` handler when Claude CLI output detected

The overlay subscribes to these via `useTabsStore`.

## Claude Detection

In the PTY `onData` handler, match a signature string from Claude CLI startup (e.g. `"Claude Code"` or the idle prompt marker). Set `boot.claudeReady = true` on first match.

## Feature Tags Animation

Bottom of overlay shows a row of feature names with staggered fade-in (Framer Motion `staggerChildren`, 200ms delay):

```
Canvas · Gallery · Timeline · Inspector · Preview
```

Purely decorative — showcases capabilities during the wait.

## Cinematic Reveal (Exit Animation)

1. All three boot flags true → 400ms settle delay (Claude paints first frame)
2. Progress bar fills to 100%, "Ready" step gets checkmark
3. 200ms hold at 100%
4. Overlay exits: `opacity 1→0`, `y 0→-20px`, 500ms ease-out
5. Workspace underneath gets subtle `scale 0.98→1` (coming-forward feel)
6. Overlay unmounts via `AnimatePresence`

## Visual Design

- **Background:** `var(--bg-primary)` (#0A0F1A) — matches terminal for seamless reveal
- **Logo:** gradient text (cyan→coral), matching project picker branding
- **Project name:** white/60 below logo
- **Step dots:** cyan (done), pulsing (active), dim (pending)
- **Step labels:** white/70, monospace
- **Status text:** white/40, right-aligned
- **Progress bar:** 3px thin, cyan fill, dark track, rounded
- **Feature tags:** white/20, small, monospace

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/stores/tabs.ts` | Add `boot` field to `TabState`, reset on creation |
| `src/renderer/hooks/usePty.ts` | Set `boot.ptyReady`, detect Claude for `boot.claudeReady`, remove `writeWelcomeBanner()` |
| `src/renderer/App.tsx` | Set `boot.mcpReady` in existing MCP handler |
| `src/renderer/components/BootOverlay/BootOverlay.tsx` | **New** — the overlay component |
| `src/renderer/components/Workspace/Workspace.tsx` | Render `<BootOverlay>` as overlay sibling |

## What Gets Removed

- `writeWelcomeBanner()` function in `usePty.ts`
- Double `terminal.reset()` + redraw pattern
- `suppressOutput` flag (overlay hides terminal, simpler approach)
