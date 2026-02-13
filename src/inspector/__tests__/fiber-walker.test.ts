import { describe, it, expect } from 'vitest'
import { getFiberFromDOM, getComponentName, getSourceInfo } from '../fiber-walker'

describe('getFiberFromDOM', () => {
  it('returns null for elements without React fiber', () => {
    const element = document.createElement('div')
    expect(getFiberFromDOM(element)).toBeNull()
  })

  it('finds React fiber key on element', () => {
    const element = document.createElement('div')
    // Simulate React's internal fiber key
    ;(element as any).__reactFiber$abc123 = {
      type: 'div',
      return: null
    }

    const fiber = getFiberFromDOM(element)
    expect(fiber).not.toBeNull()
    expect(fiber.type).toBe('div')
  })
})

describe('getComponentName', () => {
  it('returns tag name for elements without fiber', () => {
    const element = document.createElement('button')
    expect(getComponentName(element)).toBe('button')
  })

  it('returns component name from fiber', () => {
    const element = document.createElement('div')
    ;(element as any).__reactFiber$abc = {
      type: function MyButton() {},
      return: null
    }
    // getComponentName walks up looking for function types
    expect(getComponentName(element)).toBe('MyButton')
  })

  it('returns displayName when available', () => {
    const element = document.createElement('div')
    const Component = function () {}
    Component.displayName = 'StyledButton'
    ;(element as any).__reactFiber$abc = {
      type: Component,
      return: null
    }
    expect(getComponentName(element)).toBe('StyledButton')
  })
})

describe('getSourceInfo', () => {
  it('returns null for elements without fiber', () => {
    const element = document.createElement('div')
    expect(getSourceInfo(element)).toBeNull()
  })

  it('returns null when fiber has no debug source', () => {
    const element = document.createElement('div')
    ;(element as any).__reactFiber$abc = {
      type: 'div',
      return: null
    }
    expect(getSourceInfo(element)).toBeNull()
  })

  it('extracts source info from fiber debug source', () => {
    const element = document.createElement('div')
    ;(element as any).__reactFiber$abc = {
      type: { name: 'Header' },
      _debugSource: {
        fileName: '/src/components/Header.tsx',
        lineNumber: 42,
        columnNumber: 5
      },
      return: null
    }

    const info = getSourceInfo(element)
    expect(info).not.toBeNull()
    expect(info!.fileName).toBe('/src/components/Header.tsx')
    expect(info!.lineNumber).toBe(42)
    expect(info!.componentName).toBe('Header')
  })

  it('walks up fiber tree to find source', () => {
    const element = document.createElement('div')
    ;(element as any).__reactFiber$abc = {
      type: 'div',
      return: {
        type: { name: 'Card' },
        _debugSource: {
          fileName: '/src/Card.tsx',
          lineNumber: 10
        },
        return: null
      }
    }

    const info = getSourceInfo(element)
    expect(info).not.toBeNull()
    expect(info!.componentName).toBe('Card')
    expect(info!.lineNumber).toBe(10)
  })
})
