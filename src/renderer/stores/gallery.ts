import { create } from 'zustand'

export interface GalleryVariant {
  id: string
  label: string
  html: string
  css?: string
}

interface GalleryStore {
  variants: GalleryVariant[]
  selectedId: string | null
  setVariants: (variants: GalleryVariant[]) => void
  setSelectedId: (id: string | null) => void
  addVariant: (variant: GalleryVariant) => void
  removeVariant: (id: string) => void
  renameVariant: (id: string, label: string) => void
  duplicateVariant: (id: string) => void
}

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  variants: [],
  selectedId: null,
  setVariants: (variants) => set({ variants }),
  setSelectedId: (selectedId) => set({ selectedId }),
  addVariant: (variant) => set((s) => ({ variants: [...s.variants, variant] })),
  removeVariant: (id) => set((s) => ({
    variants: s.variants.filter((v) => v.id !== id),
    selectedId: s.selectedId === id ? null : s.selectedId
  })),
  renameVariant: (id, label) => set((s) => ({
    variants: s.variants.map((v) => (v.id === id ? { ...v, label } : v))
  })),
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
  },
}))
