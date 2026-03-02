import type { CriticFeedback } from './types'

/**
 * Compact format for MCP tool responses (~5 lines).
 * Claude gets verdict + summary + issue one-liners.
 * Full details are in the CriticPanel UI.
 */
export function formatFeedbackCompact(
  feedback: CriticFeedback,
  reviewType: 'plan' | 'result' = 'plan',
): string {
  const label = reviewType === 'plan' ? 'Plan' : 'Result'
  const lines: string[] = []

  lines.push(`[CRITIC] ${feedback.verdict.toUpperCase()} (${label})`)
  lines.push(feedback.summary)

  if (feedback.issues.length > 0) {
    const bySeverity = feedback.issues.reduce((acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const counts = Object.entries(bySeverity).map(([s, n]) => `${n} ${s}`).join(', ')
    lines.push(`Issues: ${counts}`)
    // One-liner per issue — no file/recommendation (those are in the panel)
    feedback.issues.forEach((issue, i) => {
      lines.push(`  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`)
    })
  }

  return lines.join('\n')
}

/**
 * Full verbose format for clipboard copy and detailed logging.
 * Used by CriticPanel "Copy Feedback" button.
 */
export function formatFeedbackForClaude(
  feedback: CriticFeedback,
  reviewType: 'plan' | 'result' = 'plan',
): string {
  const lines: string[] = []
  const label = reviewType === 'plan' ? 'Plan Review' : 'Implementation Review'
  lines.push(`[CRITIC FEEDBACK - ${label}]`)
  lines.push(`Verdict: ${feedback.verdict.toUpperCase()}`)
  lines.push('')
  lines.push(`Summary: ${feedback.summary}`)

  if (feedback.issues.length > 0) {
    lines.push('')
    lines.push(`Issues (${feedback.issues.length}):`)
    feedback.issues.forEach((issue, i) => {
      lines.push(`${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`)
      if (issue.file) lines.push(`   File: ${issue.file}`)
      if (issue.recommendation) lines.push(`   Recommendation: ${issue.recommendation}`)
    })
  }

  if (feedback.strengths && feedback.strengths.length > 0) {
    lines.push('')
    lines.push('Strengths:')
    feedback.strengths.forEach((s) => lines.push(`- ${s}`))
  }

  lines.push('')
  if (feedback.verdict === 'revise') lines.push('Please address the issues above and continue.')
  else if (feedback.verdict === 'reject') lines.push('Please reconsider the approach.')
  else lines.push('The critic approved. You may proceed.')

  return lines.join('\n') + '\n'
}
