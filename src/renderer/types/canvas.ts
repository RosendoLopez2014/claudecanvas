export type CanvasTab = 'preview' | 'gallery' | 'timeline' | 'diff' | 'deploy' | 'a11y'
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

export interface ParentLayoutInfo {
  parentDisplay?: string
  parentFlexDirection?: string
  parentJustifyContent?: string
  parentAlignItems?: string
  parentGridTemplateColumns?: string
  parentGap?: string
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
  parentLayout?: ParentLayoutInfo
  siblingCount?: number
  eventHandlers?: string[]
  html?: string
}

export interface PreviewError {
  message: string
  file: string | null
  line: number | null
  column: number | null
}

export interface ConsoleLogEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}
