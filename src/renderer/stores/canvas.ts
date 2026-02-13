import { create } from 'zustand'

export type CanvasTab = 'preview' | 'gallery' | 'timeline' | 'diff'

export interface ElementContext {
  tagName: string
  id?: string
  className?: string
  componentName?: string
  filePath?: string
  lineNumber?: number
  rect?: { top: number; left: number; width: number; height: number }
  styles?: Record<string, string>
  html?: string
}

interface CanvasStore {
  activeTab: CanvasTab
  previewUrl: string | null
  inspectorActive: boolean
  selectedElement: ElementContext | null
  setActiveTab: (tab: CanvasTab) => void
  setPreviewUrl: (url: string | null) => void
  setInspectorActive: (active: boolean) => void
  setSelectedElement: (el: ElementContext | null) => void
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  activeTab: 'preview',
  previewUrl: null,
  inspectorActive: false,
  selectedElement: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setInspectorActive: (inspectorActive) => set({ inspectorActive }),
  setSelectedElement: (selectedElement) => set({ selectedElement })
}))
