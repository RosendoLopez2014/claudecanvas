import type { CriticFeedback } from './types'

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
