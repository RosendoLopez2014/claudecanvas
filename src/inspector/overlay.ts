import { getSourceInfo, getComponentName, SourceInfo } from './fiber-walker'
import { extractStyles, ExtractedStyles } from './style-extractor'

interface InspectorMessage {
  type: string
  element?: {
    tagName: string
    id?: string
    className?: string
    componentName: string
    sourceInfo: SourceInfo | null
    styles: ExtractedStyles
    rect: { top: number; left: number; width: number; height: number }
    html: string
  }
}

class InspectorOverlay {
  private container: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private tooltip: HTMLDivElement | null = null
  private active = false
  private currentElement: HTMLElement | null = null

  init(): void {
    this.container = document.createElement('div')
    this.container.id = '__claude_inspector__'
    this.container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 999999;
    `
    document.body.appendChild(this.container)

    this.highlight = document.createElement('div')
    this.highlight.style.cssText = `
      position: fixed; pointer-events: none; transition: all 0.1s ease;
      border: 2px solid #4AEAFF; background: rgba(74, 234, 255, 0.08);
      border-radius: 2px; display: none;
    `
    this.container.appendChild(this.highlight)

    this.tooltip = document.createElement('div')
    this.tooltip.style.cssText = `
      position: fixed; pointer-events: none; background: rgba(10, 15, 26, 0.95);
      color: #C8D6E5; padding: 6px 10px; font-size: 11px; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; display: none; white-space: nowrap;
      border: 1px solid rgba(74, 234, 255, 0.3);
    `
    this.container.appendChild(this.tooltip)

    document.addEventListener('mousemove', this.handleMouseMove, true)
    document.addEventListener('click', this.handleClick, true)

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'inspector:activate') this.active = true
      if (e.data?.type === 'inspector:deactivate') {
        this.active = false
        this.hideHighlight()
      }
    })
  }

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.active) return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement
    if (!el || el.id === '__claude_inspector__' || this.container?.contains(el)) return
    if (el === this.currentElement) return

    this.currentElement = el
    this.showHighlight(el)
  }

  private handleClick = (e: MouseEvent): void => {
    if (!this.active) return
    e.preventDefault()
    e.stopPropagation()

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement
    if (!el || this.container?.contains(el)) return

    const rect = el.getBoundingClientRect()
    const sourceInfo = getSourceInfo(el)
    const componentName = getComponentName(el)
    const styles = extractStyles(el)

    const message: InspectorMessage = {
      type: 'inspector:elementSelected',
      element: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: el.className || undefined,
        componentName,
        sourceInfo,
        styles,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        html: el.outerHTML.substring(0, 300)
      }
    }

    window.parent.postMessage(message, '*')
  }

  private showHighlight(el: HTMLElement): void {
    if (!this.highlight || !this.tooltip) return
    const rect = el.getBoundingClientRect()

    this.highlight.style.top = `${rect.top}px`
    this.highlight.style.left = `${rect.left}px`
    this.highlight.style.width = `${rect.width}px`
    this.highlight.style.height = `${rect.height}px`
    this.highlight.style.display = 'block'

    const name = getComponentName(el)
    const tag = el.tagName.toLowerCase()
    this.tooltip.textContent = name !== tag ? `<${tag}> ${name}` : `<${tag}>`
    this.tooltip.style.top = `${rect.top - 28}px`
    this.tooltip.style.left = `${rect.left}px`
    this.tooltip.style.display = 'block'

    document.body.style.cursor = 'crosshair'
  }

  private hideHighlight(): void {
    if (this.highlight) this.highlight.style.display = 'none'
    if (this.tooltip) this.tooltip.style.display = 'none'
    this.currentElement = null
    document.body.style.cursor = ''
  }
}

// Auto-init when injected
const inspector = new InspectorOverlay()
inspector.init()
