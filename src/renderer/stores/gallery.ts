import { create } from 'zustand'

export interface Annotation {
  label: string
  x: number   // % from left (0-100)
  y: number   // % from top (0-100)
  color?: string
}

export interface GalleryVariant {
  id: string
  label: string
  html: string
  css?: string
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

export interface DesignSession {
  id: string
  title: string
  projectPath: string
  createdAt: number
  variants: string[]       // Ordered variant IDs
  selectedId?: string
  prompt?: string
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
}

/** Persist current variants and sessions to settings, scoped by project path */
function persistGallery(): void {
  if (typeof window === 'undefined' || !window.api?.settings) return
  const { variants, sessions, projectPath } = useGalleryStore.getState()
  if (!projectPath) return
  // Store as a map of projectPath → variants
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

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  variants: [],
  selectedId: null,
  projectPath: null,
  sessions: [],
  activeSessionId: null,
  viewMode: 'grid',
  compareIds: null,

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
}))
