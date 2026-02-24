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

/**
 * CSS Layout Visualizer — shows box model, flex/grid indicators on hover.
 *
 * Color scheme:
 * - Flex/grid lines: rgba(74, 234, 255, 0.3) (cyan)
 * - Margin: rgba(255, 155, 0, 0.15) (orange)
 * - Padding: rgba(0, 200, 100, 0.15) (green)
 * - Content: rgba(74, 234, 255, 0.1) (cyan)
 * - Labels: background: rgba(0,0,0,0.75); color: #4AEAFF
 */

const LAYOUT_LABEL_STYLE =
  "position:fixed;pointer-events:none;background:rgba(0,0,0,0.75);color:#4AEAFF;" +
  "font-size:10px;padding:1px 4px;border-radius:2px;font-family:'JetBrains Mono',monospace;" +
  "white-space:nowrap;z-index:999999;"

class InspectorOverlay {
  private container: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private tooltip: HTMLDivElement | null = null
  private layoutContainer: HTMLDivElement | null = null
  private layoutElements: HTMLDivElement[] = []
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

    // Layout visualization container
    this.layoutContainer = document.createElement('div')
    this.layoutContainer.id = '__claude_layout_overlay'
    this.layoutContainer.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999998;'
    this.container.appendChild(this.layoutContainer)

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
      // Only accept messages from same-origin parent (the Electron renderer)
      if (e.origin !== window.location.origin && e.origin !== 'null') return
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

    // Use parent origin for security — only post to same-origin parent
    const targetOrigin = window.location.origin || '*'
    window.parent.postMessage(message, targetOrigin)
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

    // Show layout overlay (box model + flex/grid)
    this.showLayoutOverlay(el)
  }

  private hideHighlight(): void {
    if (this.highlight) this.highlight.style.display = 'none'
    if (this.tooltip) this.tooltip.style.display = 'none'
    this.clearLayoutElements()
    this.currentElement = null
    document.body.style.cursor = ''
  }

  // ── Layout Visualization ──────────────────────────────────────

  private clearLayoutElements(): void {
    this.layoutElements.forEach((el) => el.remove())
    this.layoutElements = []
  }

  private createLayoutDiv(css: string): HTMLDivElement {
    const d = document.createElement('div')
    d.style.cssText = css
    this.layoutContainer!.appendChild(d)
    this.layoutElements.push(d)
    return d
  }

  private createLayoutLabel(text: string, top: number, left: number): HTMLDivElement {
    const lbl = this.createLayoutDiv(LAYOUT_LABEL_STYLE)
    lbl.textContent = text
    lbl.style.top = `${top}px`
    lbl.style.left = `${left}px`
    return lbl
  }

  /**
   * Main entry point — dispatches to box model + flex/grid overlays.
   */
  private showLayoutOverlay(el: HTMLElement): void {
    this.clearLayoutElements()
    const computed = getComputedStyle(el)
    const rect = el.getBoundingClientRect()

    // Box model is always shown
    this.showBoxModelOverlay(computed, rect)

    // Flex/grid overlay on top
    const display = computed.display
    if (display === 'flex' || display === 'inline-flex') {
      this.showFlexOverlay(el, computed, rect)
    } else if (display === 'grid' || display === 'inline-grid') {
      this.showGridOverlay(el, computed, rect)
    }
  }

  /**
   * Box Model Overlay — margin (orange), padding (green), content (cyan border).
   * Shown for ALL hovered elements.
   */
  private showBoxModelOverlay(computed: CSSStyleDeclaration, rect: DOMRect): void {
    const mt = parseFloat(computed.marginTop) || 0
    const mr = parseFloat(computed.marginRight) || 0
    const mb = parseFloat(computed.marginBottom) || 0
    const ml = parseFloat(computed.marginLeft) || 0

    const pt = parseFloat(computed.paddingTop) || 0
    const pr = parseFloat(computed.paddingRight) || 0
    const pb = parseFloat(computed.paddingBottom) || 0
    const pl = parseFloat(computed.paddingLeft) || 0

    // Margin strips — orange at 15% opacity
    if (mt > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);` +
        `top:${rect.top - mt}px;left:${rect.left - ml}px;` +
        `width:${rect.width + ml + mr}px;height:${mt}px;`
      )
      this.createLayoutLabel(`${Math.round(mt)}`, rect.top - mt / 2 - 6, rect.left + rect.width / 2 - 8)
    }
    if (mb > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);` +
        `top:${rect.bottom}px;left:${rect.left - ml}px;` +
        `width:${rect.width + ml + mr}px;height:${mb}px;`
      )
      this.createLayoutLabel(`${Math.round(mb)}`, rect.bottom + mb / 2 - 6, rect.left + rect.width / 2 - 8)
    }
    if (ml > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);` +
        `top:${rect.top}px;left:${rect.left - ml}px;` +
        `width:${ml}px;height:${rect.height}px;`
      )
      this.createLayoutLabel(`${Math.round(ml)}`, rect.top + rect.height / 2 - 6, rect.left - ml / 2 - 8)
    }
    if (mr > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);` +
        `top:${rect.top}px;left:${rect.right}px;` +
        `width:${mr}px;height:${rect.height}px;`
      )
      this.createLayoutLabel(`${Math.round(mr)}`, rect.top + rect.height / 2 - 6, rect.right + mr / 2 - 8)
    }

    // Padding strips — green at 15% opacity
    if (pt > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);` +
        `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${pt}px;`
      )
      this.createLayoutLabel(`${Math.round(pt)}`, rect.top + pt / 2 - 6, rect.left + rect.width / 2 - 8)
    }
    if (pb > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);` +
        `top:${rect.bottom - pb}px;left:${rect.left}px;width:${rect.width}px;height:${pb}px;`
      )
      this.createLayoutLabel(`${Math.round(pb)}`, rect.bottom - pb / 2 - 6, rect.left + rect.width / 2 - 8)
    }
    if (pl > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);` +
        `top:${rect.top + pt}px;left:${rect.left}px;` +
        `width:${pl}px;height:${rect.height - pt - pb}px;`
      )
      this.createLayoutLabel(`${Math.round(pl)}`, rect.top + rect.height / 2 - 6, rect.left + pl / 2 - 8)
    }
    if (pr > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);` +
        `top:${rect.top + pt}px;left:${rect.right - pr}px;` +
        `width:${pr}px;height:${rect.height - pt - pb}px;`
      )
      this.createLayoutLabel(`${Math.round(pr)}`, rect.top + rect.height / 2 - 6, rect.right - pr / 2 - 8)
    }

    // Content area — 1px cyan border
    const contentTop = rect.top + pt
    const contentLeft = rect.left + pl
    const contentWidth = rect.width - pl - pr
    const contentHeight = rect.height - pt - pb
    if (contentWidth > 0 && contentHeight > 0) {
      this.createLayoutDiv(
        `position:fixed;pointer-events:none;` +
        `border:1px solid rgba(74,234,255,0.4);background:rgba(74,234,255,0.1);` +
        `top:${contentTop}px;left:${contentLeft}px;` +
        `width:${contentWidth}px;height:${contentHeight}px;`
      )
    }
  }

  /**
   * Flex Container Overlay — direction arrow, justify/align labels, gap visualization.
   */
  private showFlexOverlay(el: HTMLElement, computed: CSSStyleDeclaration, rect: DOMRect): void {
    const dir = computed.flexDirection
    const justify = computed.justifyContent
    const align = computed.alignItems
    const gap = computed.gap

    // Direction arrow
    const arrowMap: Record<string, string> = {
      row: '\u2192', column: '\u2193', 'row-reverse': '\u2190', 'column-reverse': '\u2191'
    }
    const arrow = arrowMap[dir] || '\u2192'
    const arrowEl = this.createLayoutDiv(
      `position:fixed;pointer-events:none;display:flex;align-items:center;justify-content:center;` +
      `color:rgba(74,234,255,0.5);font-size:28px;font-weight:bold;` +
      `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`
    )
    arrowEl.textContent = arrow

    // Flex container tint
    this.createLayoutDiv(
      `position:fixed;pointer-events:none;` +
      `background:rgba(74,234,255,0.05);border:1px dashed rgba(74,234,255,0.3);` +
      `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`
    )

    // Justify/align labels
    this.createLayoutLabel(`justify: ${justify}`, rect.bottom + 2, rect.left)
    this.createLayoutLabel(`align: ${align}`, rect.bottom + 2, rect.left + (justify.length + 10) * 6.5)

    // Gap label + visualization
    if (gap && gap !== 'normal' && gap !== '0px') {
      this.createLayoutLabel(`gap: ${gap}`, rect.bottom + 16, rect.left)

      const children = el.children
      for (let ci = 0; ci < children.length - 1; ci++) {
        const childRect = children[ci].getBoundingClientRect()
        const nextRect = children[ci + 1].getBoundingClientRect()
        if (dir === 'row' || dir === 'row-reverse') {
          const gapWidth = Math.max(0, nextRect.left - childRect.right)
          if (gapWidth > 0) {
            this.createLayoutDiv(
              `position:fixed;pointer-events:none;` +
              `background:repeating-linear-gradient(90deg,rgba(74,234,255,0.2) 0px,rgba(74,234,255,0.2) 2px,transparent 2px,transparent 5px);` +
              `border-left:1px dotted rgba(74,234,255,0.4);border-right:1px dotted rgba(74,234,255,0.4);` +
              `top:${rect.top}px;left:${childRect.right}px;width:${gapWidth}px;height:${rect.height}px;`
            )
          }
        } else {
          const gapHeight = Math.max(0, nextRect.top - childRect.bottom)
          if (gapHeight > 0) {
            this.createLayoutDiv(
              `position:fixed;pointer-events:none;` +
              `background:repeating-linear-gradient(0deg,rgba(74,234,255,0.2) 0px,rgba(74,234,255,0.2) 2px,transparent 2px,transparent 5px);` +
              `border-top:1px dotted rgba(74,234,255,0.4);border-bottom:1px dotted rgba(74,234,255,0.4);` +
              `top:${childRect.bottom}px;left:${rect.left}px;width:${rect.width}px;height:${gapHeight}px;`
            )
          }
        }
      }
    }
  }

  /**
   * Grid Container Overlay — track lines, row x column badge, gap visualization.
   */
  private showGridOverlay(el: HTMLElement, computed: CSSStyleDeclaration, rect: DOMRect): void {
    const colsRaw = computed.gridTemplateColumns
    const rowsRaw = computed.gridTemplateRows
    const rowGap = parseFloat(computed.rowGap) || 0
    const colGap = parseFloat(computed.columnGap) || 0
    const gap = computed.gap

    const colSizes = colsRaw && colsRaw !== 'none'
      ? colsRaw.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n))
      : []
    const rowSizes = rowsRaw && rowsRaw !== 'none'
      ? rowsRaw.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n))
      : []

    const numCols = colSizes.length || 1
    const numRows = rowSizes.length || 1

    // Grid container tint
    this.createLayoutDiv(
      `position:fixed;pointer-events:none;` +
      `background:rgba(74,234,255,0.05);border:1px dashed rgba(74,234,255,0.3);` +
      `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`
    )

    // Grid badge
    this.createLayoutLabel(`${numCols}\u00d7${numRows} grid`, rect.bottom + 2, rect.left)

    // Gap label
    if (gap && gap !== 'normal' && gap !== '0px') {
      this.createLayoutLabel(`gap: ${gap}`, rect.bottom + 16, rect.left)
    }

    // Vertical column track lines
    if (colSizes.length > 1) {
      let xOffset = rect.left
      for (let ci = 0; ci < colSizes.length - 1; ci++) {
        xOffset += colSizes[ci]
        this.createLayoutDiv(
          `position:fixed;pointer-events:none;border-left:1px dashed rgba(74,234,255,0.2);` +
          `top:${rect.top}px;left:${xOffset}px;width:0px;height:${rect.height}px;`
        )
        if (colGap > 0) {
          this.createLayoutDiv(
            `position:fixed;pointer-events:none;background:rgba(74,234,255,0.1);` +
            `top:${rect.top}px;left:${xOffset}px;width:${colGap}px;height:${rect.height}px;`
          )
          xOffset += colGap
        }
      }
    }

    // Horizontal row track lines
    if (rowSizes.length > 1) {
      let yOffset = rect.top
      for (let ri = 0; ri < rowSizes.length - 1; ri++) {
        yOffset += rowSizes[ri]
        this.createLayoutDiv(
          `position:fixed;pointer-events:none;border-top:1px dashed rgba(74,234,255,0.2);` +
          `top:${yOffset}px;left:${rect.left}px;width:${rect.width}px;height:0px;`
        )
        if (rowGap > 0) {
          this.createLayoutDiv(
            `position:fixed;pointer-events:none;background:rgba(74,234,255,0.1);` +
            `top:${yOffset}px;left:${rect.left}px;width:${rect.width}px;height:${rowGap}px;`
          )
          yOffset += rowGap
        }
      }
    }
  }
}

// Auto-init when injected
const inspector = new InspectorOverlay()
inspector.init()
