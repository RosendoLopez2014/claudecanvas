import { describe, it, expect } from 'vitest'
import { formatFeedbackForClaude } from '../critic/format'

describe('formatFeedbackForClaude', () => {
  it('includes verdict and summary', () => {
    const out = formatFeedbackForClaude({ verdict: 'approve', summary: 'Looks good', issues: [] })
    expect(out).toContain('Verdict: APPROVE')
    expect(out).toContain('Looks good')
  })
  it('lists issues with severity labels', () => {
    const out = formatFeedbackForClaude({
      verdict: 'revise', summary: 'x',
      issues: [{ severity: 'critical', description: 'No error handling' }],
    })
    expect(out).toContain('[CRITICAL]')
    expect(out).toContain('No error handling')
  })
  it('includes file path and recommendation when present', () => {
    const out = formatFeedbackForClaude({
      verdict: 'revise', summary: 'x',
      issues: [{ severity: 'major', description: 'y', file: 'src/foo.ts', recommendation: 'Add try-catch' }],
    })
    expect(out).toContain('File: src/foo.ts')
    expect(out).toContain('Recommendation: Add try-catch')
  })
  it('handles empty issues gracefully', () => {
    const out = formatFeedbackForClaude({ verdict: 'approve', summary: 'Ok', issues: [] })
    expect(out).not.toContain('Issues')
    expect(out).toContain('proceed')
  })
})
