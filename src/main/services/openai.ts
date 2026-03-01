import OpenAI from 'openai'
import { z } from 'zod'
import type { CriticFeedback, CriticConfig } from '../../shared/critic/types'
import { CRITIC_API_TIMEOUT_MS, CRITIC_JSON_RETRY_COUNT, CRITIC_MAX_DIFF_SIZE } from '../../shared/constants'

let client: OpenAI | null = null
let cachedKey = ''

function getClient(apiKey: string): OpenAI {
  if (!client || cachedKey !== apiKey) {
    client = new OpenAI({ apiKey, timeout: CRITIC_API_TIMEOUT_MS })
    cachedKey = apiKey
  }
  return client
}

const FeedbackSchema = z.object({
  verdict: z.enum(['approve', 'revise', 'reject']),
  summary: z.string(),
  issues: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
    description: z.string(),
    file: z.string().optional(),
    recommendation: z.string().optional(),
  })),
  strengths: z.array(z.string()).optional(),
  score: z.number().min(0).max(100).optional(),
})

/**
 * Core abstraction: call OpenAI with JSON mode + retry on parse failure.
 * Redacted error logging — never logs full payloads.
 */
async function callCritic(
  apiKey: string, model: string, systemPrompt: string, userContent: string,
): Promise<CriticFeedback> {
  const ai = getClient(apiKey)
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= CRITIC_JSON_RETRY_COUNT; attempt++) {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]
    // On retry, append a correction hint
    if (attempt > 0 && lastError) {
      messages.push({
        role: 'user',
        content: `Your previous response was not valid JSON. Error: ${lastError.message}. Please return ONLY valid JSON.`,
      })
    }

    try {
      const resp = await ai.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        messages,
        temperature: 0.2,
      })
      const raw = resp.choices[0]?.message?.content ?? '{}'
      return FeedbackSchema.parse(JSON.parse(raw))
    } catch (err) {
      lastError = err as Error
      // Redacted log: show first 200 chars, not full payload
      console.error(`[critic] API call failed (attempt ${attempt + 1}):`, lastError.message.slice(0, 200))
      // Surface actionable model errors (don't retry on model-not-found)
      if (lastError.message.includes('model_not_found') || lastError.message.includes('does not exist')) {
        throw new Error(`Model "${model}" not available — change it in Critic settings`)
      }
      if (attempt >= CRITIC_JSON_RETRY_COUNT) throw lastError
    }
  }
  throw lastError!
}

const PLAN_SYSTEM = `You are a strict code plan reviewer. Analyze for correctness, completeness, risks, missing edge cases. Return ONLY valid JSON: { "verdict": "approve"|"revise"|"reject", "summary": "1-2 sentences", "issues": [{ "severity": "critical|major|minor|suggestion", "description": "...", "file": "optional", "recommendation": "optional" }], "strengths": ["optional"], "score": 0-100 }. Be concise, actionable.`

const RESULT_SYSTEM = `You are a strict code reviewer. Review an implementation (diff + diagnostics) for bugs, missing tests, security issues, code quality. Return ONLY valid JSON: { "verdict": "approve"|"revise"|"reject", "summary": "1-2 sentences", "issues": [{ "severity": "critical|major|minor|suggestion", "description": "...", "file": "optional", "recommendation": "optional" }], "strengths": ["optional"], "score": 0-100 }. Be concise, actionable. Never include sensitive data.`

// Redact secrets from diffs/diagnostics before sending to OpenAI
const SECRET_PATTERNS = [
  /^[+-]?\s*(OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE|AWS_SECRET|PRIVATE_KEY|SECRET_KEY|API_KEY|TOKEN|PASSWORD)\s*[=:].*/gmi,
  /^[+-]?\s*"?(apiKey|secret|password|token|private_key)"?\s*[=:].*/gmi,
]

function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED — secret line removed]')
  }
  return result
}

export async function reviewPlan(
  config: CriticConfig, apiKey: string, planText: string, projectContext: string,
): Promise<CriticFeedback> {
  return callCritic(apiKey, config.model, PLAN_SYSTEM,
    `Project: ${projectContext}\n\n---\n\nProposed Plan:\n${planText}`)
}

export async function reviewResult(
  config: CriticConfig, apiKey: string,
  opts: { originalPlan: string; gitDiff: string; diagnostics: { tscOutput?: string; testOutput?: string }; projectContext: string },
): Promise<CriticFeedback> {
  let diff = redactSecrets(opts.gitDiff)
  if (diff.length > CRITIC_MAX_DIFF_SIZE) diff = diff.slice(0, CRITIC_MAX_DIFF_SIZE) + '\n[...truncated]'
  const parts = [
    `Project: ${opts.projectContext}`,
    `\n---\nOriginal Plan:\n${opts.originalPlan}`,
    `\n---\nGit Diff (secrets redacted):\n${diff}`,
    opts.diagnostics.tscOutput ? `\n---\nTypeScript Check:\n${redactSecrets(opts.diagnostics.tscOutput)}` : '',
    opts.diagnostics.testOutput ? `\n---\nTest Output:\n${redactSecrets(opts.diagnostics.testOutput)}` : '',
  ].filter(Boolean).join('\n')
  return callCritic(apiKey, config.model, RESULT_SYSTEM, parts)
}
