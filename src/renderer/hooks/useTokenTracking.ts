import { useCallback, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'

// Regex patterns for extracting token usage from Claude Code CLI output
// The CLI outputs patterns like: "Cost: $0.12 (1.2K tokens)" or "~1,234 tokens"
const TOKEN_PATTERNS = [
  /(\d[\d,]*(?:\.\d+)?)\s*[Kk]\s*tokens/,  // "1.2K tokens"
  /~?(\d[\d,]*)\s*tokens/,                   // "~1,234 tokens" or "1234 tokens"
  /tokens?\s*(?:used|consumed):\s*~?(\d[\d,]*(?:\.\d+)?)/i, // "tokens used: 1234"
]

function parseTokenCount(text: string): number | null {
  for (const pattern of TOKEN_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const raw = match[1].replace(/,/g, '')
      const num = parseFloat(raw)
      // If matched the "K" pattern, multiply by 1000
      if (pattern.source.includes('[Kk]')) {
        return Math.round(num * 1000)
      }
      return Math.round(num)
    }
  }
  return null
}

export interface TokenUsage {
  sessionTokens: number
  lastUpdated: number
}

/**
 * Hook that returns a PTY output interceptor for token tracking.
 * Call `processOutput(data)` with every PTY data chunk.
 * The hook accumulates token counts and updates tab state.
 */
export function useTokenTracking(tabId: string | null) {
  const sessionTokensRef = useRef(0)
  const warningShownRef = useRef(false)

  const processOutput = useCallback((data: string) => {
    if (!tabId) return

    const count = parseTokenCount(data)
    if (count === null) return

    sessionTokensRef.current += count
    const total = sessionTokensRef.current

    useTabsStore.getState().updateTab(tabId, {
      tokenUsage: {
        sessionTokens: total,
        lastUpdated: Date.now(),
      },
    })

    // Warning at estimated 80% usage (~200K tokens is a rough session limit)
    if (total > 160_000 && !warningShownRef.current) {
      warningShownRef.current = true
      useToastStore.getState().addToast({
        message: 'Running low on tokens — consider splitting your session into a new tab',
        type: 'info',
      })
    }
  }, [tabId])

  const reset = useCallback(() => {
    sessionTokensRef.current = 0
    warningShownRef.current = false
  }, [])

  return { processOutput, reset }
}
