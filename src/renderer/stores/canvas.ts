import { create } from 'zustand'

export type CanvasTab = 'preview' | 'gallery' | 'timeline' | 'diff'
export type ViewportMode = 'desktop' | 'mobile'

export interface A11yInfo {
  role?: string
  name?: string
  disabled?: boolean
  checked?: boolean
  expanded?: boolean
  selected?: boolean
  value?: string
}

export interface ElementContext {
  tagName: string
  id?: string
  className?: string
  componentName?: string
  componentChain?: string[]
  filePath?: string
  lineNumber?: number
  props?: Record<string, unknown>
  textContent?: string
  rect?: { top: number; left: number; width: number; height: number }
  styles?: Record<string, string>
  a11y?: A11yInfo
  html?: string
}

export interface PreviewError {
  message: string
  file: string | null
  line: number | null
  column: number | null
}

interface CanvasStore {
  /** @deprecated Use `useTabsStore.getActiveTab().activeCanvasTab` */
  activeTab: CanvasTab
  /** @deprecated Use `useTabsStore.getActiveTab().previewUrl` */
  previewUrl: string | null
  /** @deprecated Use `useTabsStore.getActiveTab().inspectorActive` */
  inspectorActive: boolean
  /** @deprecated Use `useTabsStore.getActiveTab().screenshotMode` */
  screenshotMode: boolean
  /** @deprecated Use `useTabsStore.getActiveTab().viewportMode` */
  viewportMode: ViewportMode
  /** @deprecated Use `useTabsStore.getActiveTab().selectedElements` */
  selectedElements: ElementContext[]
  previewErrors: PreviewError[]
  /** @deprecated Use `useTabsStore.getActiveTab().diffBeforeHash` */
  diffBeforeHash: string | null
  /** @deprecated Use `useTabsStore.getActiveTab().diffAfterHash` */
  diffAfterHash: string | null
  /** @deprecated Use `useTabsStore.updateTab(id, { activeCanvasTab })` */
  setActiveTab: (tab: CanvasTab) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { previewUrl })` */
  setPreviewUrl: (url: string | null) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { inspectorActive })` */
  setInspectorActive: (active: boolean) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { screenshotMode })` */
  setScreenshotMode: (active: boolean) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { viewportMode })` */
  setViewportMode: (mode: ViewportMode) => void
  addSelectedElement: (el: ElementContext) => void
  clearSelectedElements: () => void
  addPreviewError: (err: PreviewError) => void
  clearPreviewErrors: () => void
  /** @deprecated Use `useTabsStore.updateTab(id, { diffBeforeHash, diffAfterHash })` */
  setDiffHashes: (before: string | null, after: string | null) => void
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  activeTab: 'preview',
  previewUrl: null,
  inspectorActive: false,
  screenshotMode: false,
  viewportMode: 'desktop' as ViewportMode,
  selectedElements: [],
  previewErrors: [],
  diffBeforeHash: null,
  diffAfterHash: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setInspectorActive: (inspectorActive) => set({ inspectorActive }),
  setScreenshotMode: (screenshotMode) => set({ screenshotMode }),
  setViewportMode: (viewportMode) => set({ viewportMode }),
  addSelectedElement: (el) => set((s) => ({ selectedElements: [...s.selectedElements, el] })),
  clearSelectedElements: () => set({ selectedElements: [] }),
  addPreviewError: (err) => set((s) => ({ previewErrors: [...s.previewErrors.slice(-19), err] })),
  clearPreviewErrors: () => set({ previewErrors: [] }),
  setDiffHashes: (diffBeforeHash, diffAfterHash) => set({ diffBeforeHash, diffAfterHash })
}))
