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
}

export const useGalleryStore = create<GalleryStore>((set) => ({
  variants: [],
  selectedId: null,
  setVariants: (variants) => set({ variants }),
  setSelectedId: (selectedId) => set({ selectedId }),
  addVariant: (variant) => set((s) => ({ variants: [...s.variants, variant] })),
  removeVariant: (id) => set((s) => ({ variants: s.variants.filter((v) => v.id !== id) }))
}))
