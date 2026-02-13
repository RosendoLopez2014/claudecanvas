export interface ExtractedStyles {
  display: string
  position: string
  width: string
  height: string
  padding: string
  margin: string
  backgroundColor: string
  color: string
  fontSize: string
  fontWeight: string
  borderRadius: string
  border: string
}

const STYLE_KEYS: (keyof ExtractedStyles)[] = [
  'display',
  'position',
  'width',
  'height',
  'padding',
  'margin',
  'backgroundColor',
  'color',
  'fontSize',
  'fontWeight',
  'borderRadius',
  'border'
]

export function extractStyles(element: HTMLElement): ExtractedStyles {
  const computed = getComputedStyle(element)
  const styles = {} as ExtractedStyles
  for (const key of STYLE_KEYS) {
    styles[key] = computed.getPropertyValue(key.replace(/([A-Z])/g, '-$1').toLowerCase())
  }
  return styles
}
