import { create } from 'zustand'

export interface Annotation {
  label: string
  x: number   // % from left (0-100)
  y: number   // % from top (0-100)
  color?: string
}

export type PreviewState = 'loading' | 'rendered' | 'error'
export type PreviewMode = 'intrinsic' | 'viewport' | 'fill'

export interface GalleryVariant {
  id: string
  label: string
  html: string
  css?: string
  /** When set, the gallery card loads this URL in the iframe instead of srcdoc */
  previewUrl?: string
  /** Source file path relative to project root (e.g., "src/components/Button.tsx").
   *  When set and the dev server is running, the gallery renders the actual component
   *  live with HMR instead of the static HTML. */
  componentPath?: string
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
  /** Preview rendering mode: intrinsic (content-sized), viewport (fixed width), fill (parent-driven) */
  previewMode?: PreviewMode
  /** Viewport width in px when previewMode is 'viewport'. Default: 900 */
  viewportWidth?: number
  /** Transient — NOT persisted. Set by postMessage from preview iframe. */
  previewStatus?: PreviewState
  /** Transient — error message from the preview iframe. */
  previewError?: string
}

export interface DesignSession {
  id: string
  title: string
  projectPath: string
  createdAt: number
  variants: string[]       // Ordered variant IDs
  selectedId?: string
  prompt?: string
}

export interface CardPosition {
  x: number
  y: number
  width: number
  height: number
  /** When true, the card was manually positioned by the user and won't be auto-reflowed */
  pinned?: boolean
}

export interface CanvasViewport {
  panX: number
  panY: number
  zoom: number
}

interface GalleryStore {
  variants: GalleryVariant[]
  selectedId: string | null
  /** The project path these variants belong to (for scoped persistence) */
  projectPath: string | null
  sessions: DesignSession[]
  activeSessionId: string | null
  viewMode: 'grid' | 'compare' | 'session'
  compareIds: [string, string] | null
  cardPositions: Record<string, CardPosition>
  viewport: CanvasViewport

  setVariants: (variants: GalleryVariant[]) => void
  setSelectedId: (id: string | null) => void
  addVariant: (variant: GalleryVariant) => void
  removeVariant: (id: string) => void
  renameVariant: (id: string, label: string) => void
  duplicateVariant: (id: string) => void
  /** Load gallery for a specific project from persisted storage */
  loadForProject: (projectPath: string) => void

  setViewMode: (mode: 'grid' | 'compare' | 'session') => void
  setActiveSession: (sessionId: string | null) => void
  setCompareIds: (ids: [string, string] | null) => void
  startSession: (session: DesignSession) => void
  endSession: (sessionId: string) => void
  selectVariant: (variantId: string) => void
  updateVariant: (variantId: string, updates: Partial<GalleryVariant>) => void
  getSessionVariants: (sessionId: string) => GalleryVariant[]
  addVariantToSession: (sessionId: string, variant: GalleryVariant) => void
  setCardPosition: (id: string, pos: CardPosition) => void
  setCardPositions: (positions: Record<string, CardPosition>) => void
  setViewport: (viewport: Partial<CanvasViewport>) => void
  /** Clear all variants, sessions, and positions */
  clearAll: () => void
}

/** Debounced persist — coalesces rapid writes into a single flush */
let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistGallery(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(flushPersist, 500)
}

function flushPersist(): void {
  if (typeof window === 'undefined' || !window.api?.settings) return
  const { variants, sessions, projectPath, cardPositions } = useGalleryStore.getState()
  if (!projectPath) return
  // Strip transient fields (previewStatus, previewError) before persisting
  const persistable = variants.map(({ previewStatus, previewError, ...rest }) => rest)
  window.api.settings.get('gallery').then((saved: Record<string, GalleryVariant[]> | null) => {
    const all = saved || {}
    all[projectPath] = persistable
    window.api.settings.set('gallery', all)
  })
  window.api.settings.get('designSessions').then((saved: Record<string, DesignSession[]> | null) => {
    const all = saved || {}
    all[projectPath] = sessions
    window.api.settings.set('designSessions', all)
  })
  window.api.settings.get('galleryPositions').then((saved: Record<string, Record<string, CardPosition>> | null) => {
    const all = saved || {}
    all[projectPath] = cardPositions
    window.api.settings.set('galleryPositions', all)
  })
}

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  variants: [],
  selectedId: null,
  projectPath: null,
  sessions: [],
  activeSessionId: null,
  viewMode: 'grid',
  compareIds: null,
  cardPositions: {},
  viewport: { panX: 0, panY: 0, zoom: 1 },

  setVariants: (variants) => { set({ variants }); persistGallery() },
  setSelectedId: (selectedId) => set({ selectedId }),

  addVariant: (variant) => {
    set((s) => ({ variants: [...s.variants, variant] }))
    persistGallery()
  },

  removeVariant: (id) => {
    set((s) => ({
      variants: s.variants.filter((v) => v.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId
    }))
    persistGallery()
  },

  renameVariant: (id, label) => {
    set((s) => ({
      variants: s.variants.map((v) => (v.id === id ? { ...v, label } : v))
    }))
    persistGallery()
  },

  duplicateVariant: (id) => {
    const original = get().variants.find((v) => v.id === id)
    if (!original) return
    const dup: GalleryVariant = {
      id: `dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `${original.label} (copy)`,
      html: original.html,
      css: original.css,
    }
    set((s) => ({ variants: [...s.variants, dup] }))
    persistGallery()
  },

  loadForProject: (projectPath) => {
    set({ projectPath, variants: [], sessions: [], selectedId: null, activeSessionId: null, cardPositions: {} })
    if (typeof window === 'undefined' || !window.api?.settings) return
    Promise.all([
      window.api.settings.get('gallery'),
      window.api.settings.get('designSessions'),
      window.api.settings.get('galleryPositions'),
    ]).then(([savedGallery, savedSessions, savedPositions]: [any, any, any]) => {
      set({
        variants: savedGallery?.[projectPath] || [],
        sessions: savedSessions?.[projectPath] || [],
        cardPositions: savedPositions?.[projectPath] || {},
      })
    })
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setCompareIds: (ids) => set({ compareIds: ids }),

  startSession: (session) => {
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: session.id,
    }))
    persistGallery()
  },

  endSession: (sessionId) => {
    set((s) => ({
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
    }))
    persistGallery()
  },

  selectVariant: (variantId) => {
    const { variants, sessions, activeSessionId } = get()
    const target = variants.find((v) => v.id === variantId)
    if (!target) return
    const sessionId = target.sessionId || activeSessionId
    set({
      selectedId: variantId,
      variants: variants.map((v) => {
        if (v.id === variantId) return { ...v, status: 'selected' as const }
        if (sessionId && v.sessionId === sessionId && v.status === 'selected') {
          return { ...v, status: 'proposal' as const }
        }
        return v
      }),
      sessions: sessions.map((s) =>
        s.id === sessionId ? { ...s, selectedId: variantId } : s
      ),
    })
    persistGallery()
  },

  updateVariant: (variantId, updates) => {
    set((s) => ({
      variants: s.variants.map((v) =>
        v.id === variantId ? { ...v, ...updates } : v
      ),
    }))
    persistGallery()
  },

  getSessionVariants: (sessionId) => {
    const { variants } = get()
    return variants
      .filter((v) => v.sessionId === sessionId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  },

  addVariantToSession: (sessionId, variant) => {
    const variantWithSession = { ...variant, sessionId }
    set((s) => ({
      variants: [...s.variants, variantWithSession],
      sessions: s.sessions.map((ses) =>
        ses.id === sessionId
          ? { ...ses, variants: [...ses.variants, variant.id] }
          : ses
      ),
    }))
    persistGallery()
  },

  setCardPosition: (id, pos) => {
    set((s) => ({
      cardPositions: { ...s.cardPositions, [id]: pos }
    }))
    persistGallery()
  },

  setCardPositions: (positions) => {
    set({ cardPositions: positions })
    persistGallery()
  },

  setViewport: (partial) => {
    set((s) => ({ viewport: { ...s.viewport, ...partial } }))
  },

  clearAll: () => {
    set({ variants: [], sessions: [], selectedId: null, activeSessionId: null, cardPositions: {}, compareIds: null })
    persistGallery()
  },

}))
