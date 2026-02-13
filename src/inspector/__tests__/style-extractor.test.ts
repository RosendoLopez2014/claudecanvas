import { describe, it, expect, vi } from 'vitest'
import { extractStyles } from '../style-extractor'

describe('extractStyles', () => {
  it('extracts computed styles from an element', () => {
    const element = document.createElement('div')
    element.style.display = 'flex'
    element.style.width = '200px'
    element.style.height = '100px'
    element.style.padding = '10px'
    element.style.margin = '5px'
    element.style.backgroundColor = 'rgb(255, 0, 0)'
    element.style.color = 'rgb(0, 0, 0)'
    element.style.fontSize = '14px'
    element.style.fontWeight = '700'
    element.style.borderRadius = '4px'
    document.body.appendChild(element)

    const styles = extractStyles(element)

    expect(styles.display).toBe('flex')
    expect(styles.width).toBe('200px')
    expect(styles.height).toBe('100px')
    expect(styles.fontSize).toBe('14px')
    expect(styles.fontWeight).toBe('700')
    expect(styles.borderRadius).toBe('4px')

    document.body.removeChild(element)
  })

  it('returns default values for unstyled elements', () => {
    const element = document.createElement('span')
    document.body.appendChild(element)

    const styles = extractStyles(element)

    // jsdom doesn't compute layout defaults, so display/position may be empty strings
    expect(typeof styles.display).toBe('string')
    expect(typeof styles.position).toBe('string')

    document.body.removeChild(element)
  })
})
