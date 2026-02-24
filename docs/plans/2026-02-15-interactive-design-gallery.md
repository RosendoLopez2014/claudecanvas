# Interactive Design Gallery — Design Document

**Date:** 2026-02-15
**Status:** Draft
**Scope:** Gallery data model, MCP tools, Claude Code skill, renderer UI

---

## 1. Vision

Today the gallery is a flat list of HTML snapshots added manually via `canvas_add_to_gallery`. The user has no way to compare options, vote on designs, or iterate with Claude in a structured way.

The vision: **the gallery becomes an interactive design workbench** where Claude generates multiple visual options with descriptions, pros/cons, and annotations — and the user reviews, compares, selects, and iterates without leaving the app. The workflow runs offline (no server needed), is driven by a Claude Code skill, and produces a self-contained design document the user can revisit across sessions.

### Core Loop

```
User (in terminal): "Show me 3 navigation layouts"
  → Claude Code skill activates
  → Claude generates 3 HTML mockups with metadata
  → MCP sends each to gallery as a "design proposal"
  → Gallery renders them in comparison view
  → User selects one (click) or asks for changes (terminal)
  → Claude iterates on the selected option
  → Final selection gets applied to the project
```

### Key Principles

1. **Terminal-first** — The skill runs in Claude Code. The gallery is the visual output surface, not the input surface.
2. **Offline** — All mockups are self-contained HTML/CSS (no external dependencies). Works on a plane.
3. **Persistent** — Design sessions are saved per-project. Revisit past explorations anytime.
4. **Structured** — Every proposal has metadata (title, description, pros, cons, category, status). Not just raw HTML.
5. **Comparative** — Side-by-side view, A/B toggle, diff overlay. Designed for choosing between options.

---

## 2. Data Model

### Current

```typescript
interface GalleryVariant {
  id: string
  label: string
  html: string
  css?: string
}
```

### Proposed

```typescript
interface GalleryVariant {
  id: string
  label: string
  html: string
  css?: string

  // ── New fields ──
  description?: string          // 1-3 sentence explanation
  category?: string             // e.g. "navigation", "auth", "landing"
  pros?: string[]               // Bullet points
  cons?: string[]               // Bullet points
  annotations?: Annotation[]    // Callouts pinned to regions
  status?: 'proposal' | 'selected' | 'rejected' | 'applied'
  parentId?: string             // Which variant this was iterated from
  sessionId?: string            // Groups variants from one design session
  createdAt?: number            // Timestamp
  order?: number                // Display order within session
}

interface Annotation {
  label: string                 // Short callout text
  x: number                    // % from left (0-100)
  y: number                    // % from top (0-100)
  color?: string               // Accent color
}

interface DesignSession {
  id: string
  title: string                // "Navigation layouts" / "Login form options"
  projectPath: string
  createdAt: number
  variants: string[]           // Ordered variant IDs
  selectedId?: string          // The chosen variant
  prompt?: string              // The original user request
}
```

### Storage

- **Variants**: Stored in `settings.gallery[projectPath]` (existing pattern)
- **Sessions**: New key `settings.designSessions[projectPath]` — array of `DesignSession`
- **Backward compatible**: Old variants without new fields render exactly as today

---

## 3. Gallery UI Changes

### 3.1 View Modes

The gallery needs three view modes, toggled via toolbar:

| Mode | Layout | Use Case |
|------|--------|----------|
| **Grid** (current) | 2-column cards | Browse all variants |
| **Compare** (new) | 2 variants side-by-side, full width | A/B comparison |
| **Session** (new) | Grouped by design session, with metadata panels | Structured review |

### 3.2 Session View

When viewing a design session:

```
┌─────────────────────────────────────────────────┐
│ Session: "Navigation Layouts"                    │
│ 3 proposals · Feb 15, 2026 · prompt: "Show me…" │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Option A │  │ Option B │  │ Option C │         │
│  │ [render] │  │ [render] │  │ [render] │         │
│  │          │  │ ✓ PICK  │  │          │         │
│  ├─────────┤  ├─────────┤  ├─────────┤         │
│  │ Sticky   │  │ Sidebar  │  │ Bottom   │         │
│  │ top nav  │  │ nav with │  │ tab bar  │         │
│  │          │  │ collapse │  │          │         │
│  │ + Fast   │  │ + More   │  │ + Mobile │         │
│  │ + Simple │  │   room   │  │   first  │         │
│  │ - Less   │  │ - Takes  │  │ - No     │         │
│  │   room   │  │   space  │  │   hover  │         │
│  └─────────┘  └─────────┘  └─────────┘         │
│                                                  │
│  [Iterate on selected] [Apply to project] [New] │
└─────────────────────────────────────────────────┘
```

### 3.3 Variant Card (Enhanced)

Each card in session view shows:
- **Rendered preview** (iframe, scaled to fit)
- **Title** (from `label`)
- **Description** (1-3 lines, from `description`)
- **Pros/Cons** (green/red bullet lists)
- **Status badge** (proposal / selected / applied)
- **Annotations** (floating callouts on hover)
- **Actions**: Select, Iterate, Duplicate, Delete, Apply

### 3.4 Compare View

Two variants side-by-side at maximum width:
- Sync-scroll option (both scroll together)
- Overlay toggle (semi-transparent diff)
- Swap left/right
- "Pick left" / "Pick right" buttons
- Annotations visible on both

### 3.5 Toolbar

```
[Grid | Compare | Session]  [Filter: category ▾]  [Session: "Nav layouts" ▾]  [+ New session]
```

---

## 4. MCP Tool Changes

### 4.1 Enhanced `canvas_add_to_gallery`

Add optional metadata fields to the existing tool:

```typescript
canvas_add_to_gallery({
  label: string,
  html: string,
  css?: string,
  // New optional fields:
  description?: string,
  category?: string,
  pros?: string[],
  cons?: string[],
  annotations?: Array<{ label: string, x: number, y: number }>,
  sessionId?: string,
  order?: number,
})
```

Backward compatible — old calls without new fields work exactly as before.

### 4.2 New Tool: `canvas_design_session`

Start or manage a design session:

```typescript
canvas_design_session({
  action: 'start' | 'end' | 'select' | 'get_status',
  // For 'start':
  title?: string,
  prompt?: string,
  // For 'select':
  variantId?: string,
})
```

**Returns** (for `get_status`):
```json
{
  "sessionId": "ds-abc123",
  "title": "Navigation layouts",
  "variantCount": 3,
  "selectedId": "var-2",
  "variants": [
    { "id": "var-1", "label": "Option A", "status": "proposal" },
    { "id": "var-2", "label": "Option B", "status": "selected" },
    { "id": "var-3", "label": "Option C", "status": "rejected" }
  ]
}
```

### 4.3 New Tool: `canvas_get_selection`

Get which variant the user selected in the gallery:

```typescript
canvas_get_selection()
// Returns: { variantId: string, label: string } | { variantId: null }
```

This enables the feedback loop: Claude generates options → user clicks one → Claude reads the selection → Claude iterates.

### 4.4 New Tool: `canvas_update_variant`

Update an existing variant's metadata or content:

```typescript
canvas_update_variant({
  variantId: string,
  label?: string,
  html?: string,
  css?: string,
  description?: string,
  pros?: string[],
  cons?: string[],
  status?: 'proposal' | 'selected' | 'rejected' | 'applied',
  annotations?: Array<{ label: string, x: number, y: number }>,
})
```

---

## 5. Claude Code Skill

### 5.1 Skill Definition

A new skill called `design-explore` (invoked as `/design-explore` or automatically when Claude detects a design exploration request).

### 5.2 Workflow

The skill instructs Claude Code to follow this protocol:

```
Phase 1: UNDERSTAND
- Ask clarifying questions if the request is vague
- Identify the component/page being designed
- Note any constraints (must be mobile-first, must use existing design system, etc.)

Phase 2: GENERATE
- Call canvas_design_session({ action: 'start', title: '...', prompt: '...' })
- Generate 2-4 distinct HTML/CSS mockups
- For each, call canvas_add_to_gallery with full metadata:
  - label: "Option A — Sticky Top Nav"
  - description: "Fixed navigation bar at the top with..."
  - pros: ["Fast access to all sections", "Familiar pattern"]
  - cons: ["Takes vertical space", "Less room for content"]
  - annotations: [{ label: "CTA button", x: 80, y: 15 }]
  - sessionId: <from phase 1>
- Call canvas_open_tab('gallery') to show the session view
- Tell the user: "I've generated N options in the gallery. Click one to select it, or describe changes."

Phase 3: ITERATE
- Wait for user response
- If user selected a variant (check via canvas_get_selection):
  - "You selected Option B. Want me to refine it or apply it?"
- If user describes changes:
  - Generate a new variant based on the feedback
  - Add it to the same session with parentId linking to the original
  - Update the gallery

Phase 4: APPLY
- When user says "apply" or "use this one":
  - Mark variant as 'applied'
  - Extract the HTML/CSS
  - Generate production React/TSX code from the mockup
  - Write it to the appropriate file in the project
  - Call canvas_start_preview to show the live result
```

### 5.3 Skill Prompt Template

```markdown
# Design Exploration Skill

You are helping the user explore design options for their project. Follow this protocol:

## When generating design proposals:

1. Start a design session: call `canvas_design_session({ action: 'start', title, prompt })`
2. Generate 2-4 DISTINCT visual options as self-contained HTML/CSS
3. Each option MUST include:
   - A clear label (e.g., "Option A — Minimal Sidebar")
   - A 1-2 sentence description
   - 2-3 pros (green bullets)
   - 2-3 cons (red bullets)
   - At least 1 annotation pointing to a key design decision
4. Add each to gallery: `canvas_add_to_gallery({ ...metadata, sessionId })`
5. Open the gallery: `canvas_open_tab('gallery')`
6. Tell the user to review and select

## Design quality requirements:

- Use the project's color scheme if known (check existing CSS/Tailwind config)
- All mockups must be self-contained (inline styles or <style> block, no external deps)
- Use realistic content (not Lorem Ipsum) — short but believable text
- Match the project's existing aesthetic (dark theme, spacing, typography)
- Each option must be genuinely different (not just color swaps)
- Include hover states and transitions where relevant

## After the user selects:

1. Check selection: `canvas_get_selection()`
2. Ask if they want refinements or want to apply it
3. If refining: generate a new variant with `parentId` linking to the selected one
4. If applying: convert the HTML mockup to production code for their framework
```

---

## 6. IPC & Event Flow

### New IPC Channels

**Main → Renderer:**
- `mcp:design-session-start` — `{ sessionId, title }`
- `mcp:design-session-end` — `{ sessionId }`
- `mcp:variant-selected` — `{ variantId }` (user clicked in gallery)

**Renderer → Main:**
- `gallery:select-variant` — `{ variantId }` (user click event)
- `gallery:get-selection` — returns `{ variantId }` (MCP tool reads this)

### Data Flow: User Selects a Variant

```
User clicks variant card in Gallery
  → Gallery.tsx calls useGalleryStore.selectVariant(id)
  → Gallery.tsx sends IPC: gallery:select-variant(variantId)
  → Main process caches selection for MCP tool
  → Claude calls canvas_get_selection()
  → Main process returns cached selection
  → Claude reads it and proceeds with iteration/apply
```

---

## 7. Implementation Plan

### Phase 1: Data Model & Storage (3 tasks)

1. **Extend GalleryVariant type** — Add all new fields to `stores/gallery.ts`
2. **Add DesignSession type** — New interface and Zustand slice
3. **Persistence** — Store sessions in settings alongside existing gallery data

### Phase 2: MCP Tools (4 tasks)

4. **Enhance canvas_add_to_gallery** — Accept new metadata fields
5. **Add canvas_design_session** — Start/end/select/status actions
6. **Add canvas_get_selection** — Read user's gallery selection
7. **Add canvas_update_variant** — Modify existing variants

### Phase 3: Gallery UI (5 tasks)

8. **Session view layout** — Grouped cards with metadata panels
9. **Enhanced variant card** — Description, pros/cons, status badge, annotations
10. **Compare view** — Side-by-side with sync scroll and overlay
11. **View mode toolbar** — Grid / Compare / Session toggle
12. **Selection interaction** — Click to select, visual feedback, IPC event

### Phase 4: Skill & Integration (3 tasks)

13. **Write design-explore skill** — Prompt template and workflow instructions
14. **Register skill in MCP config** — Auto-approve new tools
15. **CLAUDE.md documentation** — Document new tools for Claude Code

### Phase 5: Polish (3 tasks)

16. **Annotations overlay** — Floating callouts on variant cards
17. **Session history** — Dropdown to browse past design sessions
18. **Keyboard shortcuts** — Arrow keys to navigate variants, Enter to select

**Total: 18 tasks across 5 phases**

---

## 8. Open Questions

1. **Should compare view support >2 variants?** The HTML mockup pattern showed 3-4 side by side. On narrow screens this won't fit — we may need a carousel.

2. **How does "Apply to project" work?** Claude needs to convert raw HTML to the project's framework (React/Vue/Svelte). This is a separate Claude Code step, not an MCP tool. The skill should handle the conversion prompt.

3. **Should the gallery be visible from outside the app?** The self-contained HTML mockups could be exported as a standalone file (like the tab-organization-mockups.html pattern). This would let the user share design explorations with teammates.

4. **Version history per variant?** When Claude iterates on a selected variant, should the old version be preserved (linked via `parentId`) or replaced? Preserving creates a tree; replacing keeps things clean.

5. **Auto-detect design requests?** The skill could activate automatically when Claude detects prompts like "show me options for...", "design a...", "what should the X look like?". Or it could be manual-only via `/design-explore`.

---

## 9. Success Metrics

- **Adoption**: >50% of design-related prompts use the gallery workflow
- **Iteration depth**: Average 2-3 rounds of refinement per session
- **Selection rate**: >80% of sessions end with a selected variant
- **Apply rate**: >60% of selected variants get applied to the project
- **Session reuse**: Users revisit past sessions to reference design decisions

---

## 10. Appendix: Gallery Card Anatomy

```
┌────────────────────────────────────────┐
│                                        │
│            [iframe preview]            │
│          scaled to fit width           │
│        max 500px visible height        │
│           fade gradient ↓              │
│                                        │
├────────────────────────────────────────┤
│ Option B — Sidebar Navigation          │
│                                        │
│ Collapsible sidebar with icon-only     │
│ collapsed state. Expands on hover.     │
│                                        │
│ + More content space when collapsed    │
│ + Icon tooltips for quick access       │
│ + Familiar desktop pattern             │
│                                        │
│ - Takes horizontal space on mobile     │
│ - Requires icon design for each item   │
│                                        │
│ [✓ Selected]  [Iterate]  [Apply]  [⋯] │
└────────────────────────────────────────┘
```
