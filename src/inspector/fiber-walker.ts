export interface SourceInfo {
  fileName: string
  lineNumber: number
  columnNumber?: number
  componentName: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFiberFromDOM(element: HTMLElement): any | null {
  const key = Object.keys(element).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (element as any)[key] : null
}

export function getSourceInfo(element: HTMLElement): SourceInfo | null {
  let fiber = getFiberFromDOM(element)
  if (!fiber) return null

  while (fiber) {
    if (fiber._debugSource) {
      const name =
        fiber.type?.displayName ||
        fiber.type?.name ||
        (typeof fiber.type === 'string' ? fiber.type : 'Unknown')
      return {
        fileName: fiber._debugSource.fileName,
        lineNumber: fiber._debugSource.lineNumber,
        columnNumber: fiber._debugSource.columnNumber,
        componentName: name
      }
    }
    fiber = fiber.return
  }
  return null
}

export function getComponentName(element: HTMLElement): string {
  let fiber = getFiberFromDOM(element)
  while (fiber) {
    if (typeof fiber.type === 'function' || typeof fiber.type === 'object') {
      return fiber.type?.displayName || fiber.type?.name || 'Component'
    }
    fiber = fiber.return
  }
  return element.tagName.toLowerCase()
}
