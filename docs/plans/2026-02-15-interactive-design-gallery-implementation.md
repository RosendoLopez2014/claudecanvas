# Interactive Design Gallery — Implementation Plan

**Date:** 2026-02-15
**Design Doc:** `docs/plans/2026-02-15-interactive-design-gallery.md`
**Status:** Ready for execution
**Estimated Tasks:** 18 across 5 phases

---

## How to Execute This Plan

This plan is designed for a Claude Code session using the `superpowers:executing-plans` or `superpowers:subagent-driven-development` skill. Each task specifies exact files, code patterns, and verification steps. Tasks within a phase can often be parallelized; phases must run sequentially.

**Before starting:** Run `npx tsc --noEmit` to confirm a clean baseline.

---

## Phase 1: Data Model & Storage (3 tasks)

### Task 1.1 — Extend GalleryVariant type

**File:** `src/renderer/stores/gallery.ts`

Add new optional fields to the existing `GalleryVariant` interface (line 3-8):

```typescript
export interface GalleryVariant {
  id: string
  label: string
  html: string
  css?: string
  // ── New fields ──
  description?: string
  category?: string
  pros?: string[]
  cons?: string[]
  annotations?: Annotation[]
  status?: 'proposal' | 'selected' | 'rejected' | 'applied'
  parentId?: string
  sessionId?: string
  createdAt?: number
  order?: number
}

export interface Annotation {
  label: string
  x: number   // % from left (0-100)
  y: number   // % from top (0-100)
  color?: string
}
```

**Backward compatible:** All new fields are optional. Existing variants without them render exactly as today.

**Verification:** `npx tsc --noEmit`

---

### Task 1.2 — Add DesignSession type and Zustand slice

**File:** `src/renderer/stores/gallery.ts`

Add the `DesignSession` interface and extend the store:

```typescript
export interface DesignSession {
  id: string
  title: string
  projectPath: string
  createdAt: number
  variants: string[]       // Ordered variant IDs
  selectedId?: string
  prompt?: string
}
```

Extend `GalleryStore` interface with new state and actions:

```typescript
interface GalleryStore {
  // ...existing fields...
  sessions: DesignSession[]
  activeSessionId: string | null
  viewMode: 'grid' | 'compare' | 'session'
  compareIds: [string, string] | null

  // New actions
  setViewMode: (mode: 'grid' | 'compare' | 'session') => void
  setActiveSession: (sessionId: string | null) => void
  setCompareIds: (ids: [string, string] | null) => void
  startSession: (session: DesignSession) => void
  endSession: (sessionId: string) => void
  selectVariant: (variantId: string) => void
  updateVariant: (variantId: string, updates: Partial<GalleryVariant>) => void
  getSessionVariants: (sessionId: string) => GalleryVariant[]
  addVariantToSession: (sessionId: string, variant: GalleryVariant) => void
}
```

Implement each action in the `create<GalleryStore>` call:

- `startSession`: Push to `sessions[]`, set `activeSessionId`, persist
- `endSession`: Set `activeSessionId` to null if it matches
- `selectVariant`: Find variant, set `status: 'selected'`, set all siblings in same session to `'proposal'` or `'rejected'`, persist. Also update `session.selectedId`
- `updateVariant`: Merge partial into matching variant by id, persist
- `getSessionVariants`: Filter `variants` by `sessionId`, sort by `order`
- `addVariantToSession`: Call `addVariant`, then push variant.id to `session.variants[]`

**Verification:** `npx tsc --noEmit`

---

### Task 1.3 — Persist sessions in settings

**File:** `src/renderer/stores/gallery.ts`

Update `persistGallery()` function to also persist sessions:

```typescript
function persistGallery(): void {
  if (typeof window === 'undefined' || !window.api?.settings) return
  const { variants, sessions, projectPath } = useGalleryStore.getState()
  if (!projectPath) return
  window.api.settings.get('gallery').then((saved: Record<string, GalleryVariant[]> | null) => {
    const all = saved || {}
    all[projectPath] = variants
    window.api.settings.set('gallery', all)
  })
  // Persist sessions separately
  window.api.settings.get('designSessions').then((saved: Record<string, DesignSession[]> | null) => {
    const all = saved || {}
    all[projectPath] = sessions
    window.api.settings.set('designSessions', all)
  })
}
```

Update `loadForProject` to also load sessions:

```typescript
loadForProject: (projectPath) => {
  set({ projectPath, variants: [], sessions: [], selectedId: null, activeSessionId: null })
  if (typeof window === 'undefined' || !window.api?.settings) return
  window.api.settings.get('gallery').then((saved: Record<string, GalleryVariant[]> | null) => {
    const variants = saved?.[projectPath] || []
    set({ variants })
  })
  window.api.settings.get('designSessions').then((saved: Record<string, DesignSession[]> | null) => {
    const sessions = saved?.[projectPath] || []
    set({ sessions })
  })
},
```

**Verification:** `npx tsc --noEmit` + `npm run dev` → gallery still loads existing variants

---

## Phase 2: MCP Tools (4 tasks)

### Task 2.1 — Enhance canvas_add_to_gallery

**File:** `src/main/mcp/tools.ts` (line 119-133)

Add new optional parameters to the `canvas_add_to_gallery` tool schema:

```typescript
server.tool(
  'canvas_add_to_gallery',
  'Add a component variant to the gallery with optional design metadata. Auto-opens the gallery tab.',
  {
    label: z.string().describe('Name for this variant (e.g., "Option A — Sticky Top Nav")'),
    html: z.string().describe('HTML content of the variant'),
    css: z.string().optional().describe('Optional CSS styles'),
    // New optional fields
    description: z.string().optional().describe('1-3 sentence explanation of this design option'),
    category: z.string().optional().describe('Design category (e.g., "navigation", "auth", "landing")'),
    pros: z.array(z.string()).optional().describe('List of advantages/pros for this design'),
    cons: z.array(z.string()).optional().describe('List of disadvantages/cons for this design'),
    annotations: z.array(z.object({
      label: z.string(),
      x: z.number().describe('% from left (0-100)'),
      y: z.number().describe('% from top (0-100)')
    })).optional().describe('Callout annotations pinned to regions of the design'),
    sessionId: z.string().optional().describe('Design session ID to group this variant with'),
    order: z.number().optional().describe('Display order within the session'),
  },
  async ({ label, html, css, description, category, pros, cons, annotations, sessionId, order }) => {
    const win = getWindow()
    if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
    win.webContents.send('mcp:add-to-gallery', {
      projectPath, label, html, css,
      description, category, pros, cons, annotations, sessionId, order
    })
    return { content: [{ type: 'text', text: `Added "${label}" to the gallery.` }] }
  }
)
```

**File:** `src/preload/index.ts` (line 294)

Update the `onAddToGallery` IPC listener type to include new fields:

```typescript
onAddToGallery: (cb: (data: {
  projectPath?: string
  label: string
  html: string
  css?: string
  description?: string
  category?: string
  pros?: string[]
  cons?: string[]
  annotations?: Array<{ label: string; x: number; y: number }>
  sessionId?: string
  order?: number
}) => void) => onIpc('mcp:add-to-gallery', cb),
```

**File:** `src/renderer/hooks/useMcpCommands.ts` (line 180-193)

Update the `canvas_add_to_gallery` handler to pass new fields:

```typescript
cleanups.push(
  window.api.mcp.onAddToGallery(({ projectPath: eventPath, label, html, css, description, category, pros, cons, annotations, sessionId, order }) => {
    if (shouldSkipEvent(eventPath)) return
    const variant: GalleryVariant = {
      id: `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      html: css ? `<style>${css}</style>${html}` : html,
      css,
      description,
      category,
      pros,
      cons,
      annotations,
      sessionId,
      order,
      status: 'proposal',
      createdAt: Date.now(),
    }
    if (sessionId) {
      useGalleryStore.getState().addVariantToSession(sessionId, variant)
    } else {
      useGalleryStore.getState().addVariant(variant)
    }
    ensureCanvasOpen()
    useCanvasStore.getState().setActiveTab('gallery')
    updateTargetTab(eventPath, { activeCanvasTab: 'gallery' })
  })
)
```

**File:** `src/main/mcp/config-writer.ts`

Add new tool permissions to `allowedTools` array:

```typescript
'mcp__claude-canvas__canvas_design_session',
'mcp__claude-canvas__canvas_get_selection',
'mcp__claude-canvas__canvas_update_variant',
```

**Verification:** `npx tsc --noEmit`

---

### Task 2.2 — Add canvas_design_session tool

**File:** `src/main/mcp/tools.ts`

Add after the `canvas_add_to_gallery` tool registration (around line 133):

```typescript
server.tool(
  'canvas_design_session',
  'Start, end, select a variant in, or get status of a design session. Sessions group related design variants for comparison.',
  {
    action: z.enum(['start', 'end', 'select', 'get_status']).describe('Action to perform'),
    title: z.string().optional().describe('Session title (for "start" action)'),
    prompt: z.string().optional().describe('The original user request (for "start" action)'),
    variantId: z.string().optional().describe('Variant ID to select (for "select" action)'),
  },
  async ({ action, title, prompt, variantId }) => {
    const win = getWindow()
    if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

    if (action === 'start') {
      const sessionId = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      win.webContents.send('mcp:design-session', {
        projectPath, action: 'start', sessionId, title: title || 'Design Session', prompt
      })
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId, title }) }] }
    }

    if (action === 'end') {
      win.webContents.send('mcp:design-session', { projectPath, action: 'end' })
      return { content: [{ type: 'text', text: 'Design session ended.' }] }
    }

    if (action === 'select' && variantId) {
      win.webContents.send('mcp:design-session', { projectPath, action: 'select', variantId })
      return { content: [{ type: 'text', text: `Variant ${variantId} selected.` }] }
    }

    if (action === 'get_status') {
      const status = await win.webContents.executeJavaScript(`
        (function() {
          var store = window.__galleryState;
          if (!store) return JSON.stringify({ error: 'Gallery state not available' });
          return JSON.stringify(store);
        })()
      `)
      return { content: [{ type: 'text', text: status }] }
    }

    return { content: [{ type: 'text', text: 'Invalid action or missing parameters.' }] }
  }
)
```

**File:** `src/preload/index.ts`

Add new IPC listener in the `mcp` section:

```typescript
onDesignSession: (cb: (data: {
  projectPath?: string
  action: string
  sessionId?: string
  title?: string
  prompt?: string
  variantId?: string
}) => void) => onIpc('mcp:design-session', cb),
```

**File:** `src/renderer/hooks/useMcpCommands.ts`

Add handler for the new IPC channel:

```typescript
// canvas_design_session
cleanups.push(
  window.api.mcp.onDesignSession(({ projectPath: eventPath, action, sessionId, title, prompt, variantId }) => {
    if (shouldSkipEvent(eventPath)) return
    const gallery = useGalleryStore.getState()

    if (action === 'start' && sessionId) {
      gallery.startSession({
        id: sessionId,
        title: title || 'Design Session',
        projectPath: eventPath || '',
        createdAt: Date.now(),
        variants: [],
        prompt,
      })
      gallery.setViewMode('session')
      ensureCanvasOpen()
      useCanvasStore.getState().setActiveTab('gallery')
      updateTargetTab(eventPath, { activeCanvasTab: 'gallery' })
    }

    if (action === 'end') {
      gallery.endSession(gallery.activeSessionId || '')
    }

    if (action === 'select' && variantId) {
      gallery.selectVariant(variantId)
    }
  })
)
```

**File:** `src/renderer/hooks/useMcpCommands.ts` (or `src/renderer/App.tsx`)

Expose gallery state on `window.__galleryState` so the MCP `get_status` executeJavaScript call works:

```typescript
// In a useEffect that runs when gallery state changes:
useEffect(() => {
  const unsub = useGalleryStore.subscribe((state) => {
    const activeSession = state.sessions.find(s => s.id === state.activeSessionId)
    ;(window as any).__galleryState = {
      activeSessionId: state.activeSessionId,
      viewMode: state.viewMode,
      sessionTitle: activeSession?.title || null,
      variantCount: activeSession ? activeSession.variants.length : state.variants.length,
      selectedId: state.selectedId,
      variants: (activeSession
        ? state.variants.filter(v => activeSession.variants.includes(v.id))
        : state.variants
      ).map(v => ({ id: v.id, label: v.label, status: v.status || 'proposal' })),
    }
  })
  return unsub
}, [])
```

**Verification:** `npx tsc --noEmit`

---

### Task 2.3 — Add canvas_get_selection tool

**File:** `src/main/mcp/tools.ts`

```typescript
server.tool(
  'canvas_get_selection',
  'Get which variant the user selected in the gallery. Returns the variant ID and label, or null if nothing selected.',
  {},
  async () => {
    const win = getWindow()
    if (!win) return { content: [{ type: 'text', text: JSON.stringify({ variantId: null }) }] }
    const selection = await win.webContents.executeJavaScript(`
      (function() {
        var store = window.__galleryState;
        if (!store || !store.selectedId) return JSON.stringify({ variantId: null });
        var variant = store.variants.find(function(v) { return v.id === store.selectedId; });
        return variant
          ? JSON.stringify({ variantId: variant.id, label: variant.label })
          : JSON.stringify({ variantId: null });
      })()
    `)
    return { content: [{ type: 'text', text: selection }] }
  }
)
```

**Verification:** `npx tsc --noEmit`

---

### Task 2.4 — Add canvas_update_variant tool

**File:** `src/main/mcp/tools.ts`

```typescript
server.tool(
  'canvas_update_variant',
  'Update an existing gallery variant\'s metadata or content.',
  {
    variantId: z.string().describe('ID of the variant to update'),
    label: z.string().optional().describe('New label'),
    html: z.string().optional().describe('New HTML content'),
    css: z.string().optional().describe('New CSS styles'),
    description: z.string().optional().describe('New description'),
    pros: z.array(z.string()).optional().describe('Updated pros list'),
    cons: z.array(z.string()).optional().describe('Updated cons list'),
    status: z.enum(['proposal', 'selected', 'rejected', 'applied']).optional().describe('New status'),
    annotations: z.array(z.object({
      label: z.string(),
      x: z.number(),
      y: z.number()
    })).optional().describe('Updated annotations'),
  },
  async ({ variantId, ...updates }) => {
    const win = getWindow()
    if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }
    win.webContents.send('mcp:update-variant', { projectPath, variantId, ...updates })
    return { content: [{ type: 'text', text: `Updated variant ${variantId}.` }] }
  }
)
```

**File:** `src/preload/index.ts`

```typescript
onUpdateVariant: (cb: (data: {
  projectPath?: string
  variantId: string
  label?: string
  html?: string
  css?: string
  description?: string
  pros?: string[]
  cons?: string[]
  status?: string
  annotations?: Array<{ label: string; x: number; y: number }>
}) => void) => onIpc('mcp:update-variant', cb),
```

**File:** `src/renderer/hooks/useMcpCommands.ts`

```typescript
// canvas_update_variant
cleanups.push(
  window.api.mcp.onUpdateVariant(({ projectPath: eventPath, variantId, ...updates }) => {
    if (shouldSkipEvent(eventPath)) return
    useGalleryStore.getState().updateVariant(variantId, updates)
  })
)
```

**Verification:** `npx tsc --noEmit`

---

## Phase 3: Gallery UI (5 tasks)

### Task 3.1 — Session view layout

**File:** `src/renderer/components/Gallery/Gallery.tsx`

Replace the single grid layout with a view-mode-aware layout. The `Gallery` component should:

1. Import new store fields: `viewMode`, `sessions`, `activeSessionId`, `getSessionVariants`, `setActiveSession`, `setViewMode`
2. When `viewMode === 'session'` and `activeSessionId` is set:
   - Show session header (title, variant count, creation date, original prompt)
   - Render variants in a responsive grid (2-3 columns depending on count)
   - Show action bar at bottom: [Iterate on selected] [Apply to project]
3. When `viewMode === 'grid'` (default, current behavior):
   - Render all variants in 2-column grid (current layout, unchanged)
4. When `viewMode === 'compare'`:
   - Render two variants side-by-side at full width (see Task 3.3)

Add a `SessionHeader` subcomponent:

```tsx
function SessionHeader({ session }: { session: DesignSession }) {
  const variantCount = useGalleryStore(s => s.variants.filter(v => v.sessionId === session.id).length)
  return (
    <div className="mb-4 pb-3 border-b border-white/10">
      <h3 className="text-sm font-medium text-white/80">{session.title}</h3>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-white/30">
        <span>{variantCount} proposals</span>
        <span>&middot;</span>
        <span>{new Date(session.createdAt).toLocaleDateString()}</span>
        {session.prompt && (
          <>
            <span>&middot;</span>
            <span className="truncate max-w-[200px]">prompt: "{session.prompt}"</span>
          </>
        )}
      </div>
    </div>
  )
}
```

**Verification:** `npx tsc --noEmit` + visual check that grid mode still works

---

### Task 3.2 — Enhanced variant card

**File:** `src/renderer/components/Gallery/Gallery.tsx`

Enhance `GalleryCard` to show new metadata when available:

1. Below the iframe preview, add a metadata section (only shown when variant has `description`, `pros`, or `cons`):

```tsx
{/* Metadata panel — shown when variant has design metadata */}
{(variant.description || variant.pros?.length || variant.cons?.length) && (
  <div className="px-3 py-2 bg-[var(--bg-secondary)] border-t border-white/5 space-y-2">
    {variant.description && (
      <p className="text-[11px] text-white/50 leading-relaxed">{variant.description}</p>
    )}
    {variant.pros?.length > 0 && (
      <ul className="space-y-0.5">
        {variant.pros.map((pro, i) => (
          <li key={i} className="text-[11px] text-emerald-400/70 flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">+</span>
            <span>{pro}</span>
          </li>
        ))}
      </ul>
    )}
    {variant.cons?.length > 0 && (
      <ul className="space-y-0.5">
        {variant.cons.map((con, i) => (
          <li key={i} className="text-[11px] text-red-400/70 flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">-</span>
            <span>{con}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
)}
```

2. Add a status badge in the top-left corner:

```tsx
{variant.status && variant.status !== 'proposal' && (
  <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium z-10 ${
    variant.status === 'selected' ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]' :
    variant.status === 'applied' ? 'bg-emerald-500/20 text-emerald-400' :
    variant.status === 'rejected' ? 'bg-red-500/20 text-red-400/60' : ''
  }`}>
    {variant.status === 'selected' ? '✓ Selected' :
     variant.status === 'applied' ? '✓ Applied' :
     variant.status === 'rejected' ? 'Rejected' : variant.status}
  </div>
)}
```

3. Update the click handler to call `selectVariant` instead of just `setSelectedId` when in session view mode.

**Verification:** `npx tsc --noEmit` + visual check with existing gallery items (should look identical since they have no metadata)

---

### Task 3.3 — Compare view

**File:** `src/renderer/components/Gallery/Gallery.tsx`

Add a `CompareView` subcomponent used when `viewMode === 'compare'`:

```tsx
function CompareView() {
  const { compareIds, variants, setCompareIds, selectVariant } = useGalleryStore()
  const [syncScroll, setSyncScroll] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  if (!compareIds) return <div className="text-white/30 text-sm text-center py-8">Select two variants to compare</div>

  const [leftVariant, rightVariant] = compareIds.map(id => variants.find(v => v.id === id))
  if (!leftVariant || !rightVariant) return null

  // Sync scroll handler
  const handleScroll = (source: 'left' | 'right') => {
    if (!syncScroll) return
    const from = source === 'left' ? leftRef.current : rightRef.current
    const to = source === 'left' ? rightRef.current : leftRef.current
    if (from && to) to.scrollTop = from.scrollTop
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compare toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <button onClick={() => setSyncScroll(!syncScroll)}
            className={`text-[10px] px-2 py-1 rounded ${syncScroll ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]' : 'text-white/30 hover:text-white/50'}`}>
            Sync scroll
          </button>
          <button onClick={() => setCompareIds([compareIds[1], compareIds[0]])}
            className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1">
            Swap sides
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => selectVariant(leftVariant.id)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20">
            Pick left
          </button>
          <button onClick={() => selectVariant(rightVariant.id)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20">
            Pick right
          </button>
        </div>
      </div>
      {/* Side-by-side iframes */}
      <div className="flex-1 flex gap-px bg-white/5">
        <div ref={leftRef} className="flex-1 overflow-auto" onScroll={() => handleScroll('left')}>
          <GalleryCard variant={leftVariant} isSelected={leftVariant.status === 'selected'} isExpanded={true} onSelect={() => {}} onToggleExpand={() => {}} />
        </div>
        <div ref={rightRef} className="flex-1 overflow-auto" onScroll={() => handleScroll('right')}>
          <GalleryCard variant={rightVariant} isSelected={rightVariant.status === 'selected'} isExpanded={true} onSelect={() => {}} onToggleExpand={() => {}} />
        </div>
      </div>
    </div>
  )
}
```

**Verification:** `npx tsc --noEmit`

---

### Task 3.4 — View mode toolbar

**File:** `src/renderer/components/Gallery/Gallery.tsx`

Add a toolbar at the top of the Gallery component, above the grid:

```tsx
function GalleryToolbar() {
  const { viewMode, setViewMode, sessions, activeSessionId, setActiveSession } = useGalleryStore()

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
      {/* View mode toggle */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5">
        {(['grid', 'compare', 'session'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-2.5 py-1 text-[10px] rounded transition-colors ${
              viewMode === mode
                ? 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Session selector (only in session mode) */}
      {viewMode === 'session' && sessions.length > 0 && (
        <select
          value={activeSessionId || ''}
          onChange={(e) => setActiveSession(e.target.value || null)}
          className="bg-[var(--bg-primary)] border border-white/10 rounded text-[11px] text-white/60 px-2 py-1 outline-none"
        >
          <option value="">All sessions</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      )}
    </div>
  )
}
```

Update the main `Gallery` component to render the toolbar and switch between views:

```tsx
export function Gallery() {
  const { variants, viewMode } = useGalleryStore()

  if (variants.length === 0) {
    return /* ...existing empty state... */
  }

  return (
    <div className="h-full flex flex-col">
      <GalleryToolbar />
      <div className="flex-1 overflow-auto">
        {viewMode === 'grid' && <GridView />}
        {viewMode === 'compare' && <CompareView />}
        {viewMode === 'session' && <SessionView />}
      </div>
    </div>
  )
}
```

Extract the existing grid layout into a `GridView` component and create a `SessionView` component.

**Verification:** `npx tsc --noEmit` + visual check — toolbar appears, grid mode works

---

### Task 3.5 — Selection interaction + IPC event

**File:** `src/renderer/components/Gallery/Gallery.tsx`

When a variant card is clicked in session view:

1. Call `useGalleryStore.getState().selectVariant(variantId)` (marks it selected, others as proposal)
2. Visual feedback: cyan ring around selected card, "Selected" badge
3. Send IPC event so main process can cache the selection for `canvas_get_selection`:

```typescript
// In the click handler for variant cards (session mode):
const handleSelectInSession = (variantId: string) => {
  useGalleryStore.getState().selectVariant(variantId)
  // Notify main process for MCP tool feedback loop
  window.api.mcp.gallerySelect?.(variantId)
}
```

**File:** `src/preload/index.ts`

Add to the `mcp` section:

```typescript
gallerySelect: (variantId: string) => ipcRenderer.send('gallery:select-variant', variantId),
```

**File:** `src/main/mcp/server.ts` (or a new file `src/main/mcp/gallery-state.ts`)

Cache the selection in the main process:

```typescript
import { ipcMain } from 'electron'

let cachedSelection: { variantId: string } | null = null

export function setupGalleryIpc(): void {
  ipcMain.on('gallery:select-variant', (_event, variantId: string) => {
    cachedSelection = { variantId }
  })
}

export function getGallerySelection(): { variantId: string } | null {
  return cachedSelection
}

export function clearGallerySelection(): void {
  cachedSelection = null
}
```

Then update the `canvas_get_selection` tool to use this cache as a fallback/primary source.

**Verification:** `npx tsc --noEmit`

---

## Phase 4: Skill & Integration (3 tasks)

### Task 4.1 — Write design-explore skill

**File:** `src/main/mcp/config-writer.ts`

Add to the `CANVAS_CLAUDE_MD` string (the CLAUDE.md template written to projects):

```markdown
## Design Exploration

When the user asks to explore design options (e.g., "show me 3 navigation layouts", "design a login page"):

1. Start a session: `canvas_design_session({ action: 'start', title: '...', prompt: '...' })`
2. Generate 2-4 DISTINCT HTML/CSS mockups
3. For each, call `canvas_add_to_gallery` with full metadata:
   - label, description, pros (2-3), cons (2-3), annotations, sessionId
4. Open the gallery: `canvas_open_tab('gallery')`
5. Tell the user to review and click their preferred option
6. Check selection: `canvas_get_selection()`
7. If refining: generate a new variant with parentId linking to selected
8. If applying: convert HTML mockup to production code for the project's framework

### Design quality rules:
- Use the project's color scheme (check existing CSS/Tailwind config)
- Self-contained HTML/CSS (inline styles or <style>, no external deps)
- Realistic content (not Lorem Ipsum)
- Each option must be genuinely different
```

### Task 4.2 — Register new tools in MCP config auto-approvals

**File:** `src/main/mcp/config-writer.ts`

Add to the `allowedTools` array (around line 220-256):

```typescript
'mcp__claude-canvas__canvas_design_session',
'mcp__claude-canvas__canvas_get_selection',
'mcp__claude-canvas__canvas_update_variant',
```

**Verification:** `npx tsc --noEmit`

---

### Task 4.3 — Update CLAUDE.md tool documentation

**File:** `src/main/mcp/config-writer.ts`

Add new tools to the `## Canvas MCP Tools` section of `CANVAS_CLAUDE_MD`:

```markdown
- `canvas_design_session` — Start/end/select/get_status for design sessions
- `canvas_get_selection` — Get user's selected variant from gallery
- `canvas_update_variant` — Update variant metadata/content
```

**Verification:** `npx tsc --noEmit`

---

## Phase 5: Polish (3 tasks)

### Task 5.1 — Annotations overlay

**File:** `src/renderer/components/Gallery/Gallery.tsx`

Add annotation callouts that appear on hover over variant cards:

```tsx
{/* Annotations overlay — shown on hover */}
{variant.annotations?.length > 0 && (
  <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
    {variant.annotations.map((ann, i) => (
      <div
        key={i}
        className="absolute pointer-events-auto"
        style={{ left: `${ann.x}%`, top: `${ann.y * scale}%` }}
      >
        <div className={`px-2 py-1 rounded-full text-[9px] font-medium shadow-lg whitespace-nowrap ${
          ann.color ? '' : 'bg-[var(--accent-cyan)] text-black'
        }`} style={ann.color ? { backgroundColor: ann.color, color: '#000' } : undefined}>
          {ann.label}
        </div>
      </div>
    ))}
  </div>
)}
```

**Verification:** Visual check with a variant that has annotations

---

### Task 5.2 — Session history dropdown

**File:** `src/renderer/components/Gallery/Gallery.tsx`

In the `GalleryToolbar`, enhance the session selector to show more detail:

- Session title
- Variant count
- Creation date
- Selected variant indicator
- Click to switch between sessions

This is already partially implemented in Task 3.4. Enhance it to be a proper dropdown with `Popover` or a custom menu instead of a native `<select>`.

---

### Task 5.3 — Keyboard shortcuts

**File:** `src/renderer/hooks/useKeyboardShortcuts.ts`

Add gallery-specific shortcuts when the gallery tab is active:

- `ArrowLeft` / `ArrowRight` — Navigate between variants
- `Enter` — Select the focused variant
- `C` — Toggle compare mode with focused + selected variant
- `1` / `2` / `3` — Quick-select variant by position

**File:** `src/renderer/components/Gallery/Gallery.tsx`

Track a `focusedIndex` state and handle keyboard events.

---

## Final Verification

After all phases are complete:

1. `npx tsc --noEmit` — clean type check
2. `npm run dev` — full app runs
3. Test existing gallery (grid view with old variants) — should work identically
4. Test new session flow:
   - In Claude Code terminal, have Claude call `canvas_design_session({ action: 'start', title: 'Test' })`
   - Then `canvas_add_to_gallery` with pros/cons/description
   - Gallery should show session view with metadata cards
   - Click a variant → selection feedback + `canvas_get_selection` returns it
5. Test compare view — select two variants, toggle compare mode
6. Test persistence — close and reopen app, sessions should persist

---

## File Modification Summary

| File | Changes |
|------|---------|
| `src/renderer/stores/gallery.ts` | Extended types, new store actions, session persistence |
| `src/main/mcp/tools.ts` | 3 new tools + enhanced `canvas_add_to_gallery` |
| `src/preload/index.ts` | New IPC listener types, `gallerySelect` sender |
| `src/renderer/hooks/useMcpCommands.ts` | Handlers for new IPC events, `__galleryState` exposure |
| `src/renderer/components/Gallery/Gallery.tsx` | Complete UI overhaul: 3 view modes, enhanced cards, toolbar |
| `src/main/mcp/config-writer.ts` | New tool approvals, updated CLAUDE.md template |
| `src/renderer/hooks/useKeyboardShortcuts.ts` | Gallery keyboard shortcuts |
| `src/main/mcp/gallery-state.ts` (new) | Selection cache for MCP feedback loop |

**Total: 7 modified files + 1 new file**
