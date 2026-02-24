import { useState } from 'react'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'
import { Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

/** Rough session token limit estimate (Claude Code typically allows ~250K) */
const ESTIMATED_LIMIT = 250_000

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function getColor(ratio: number): string {
  if (ratio < 0.6) return 'text-green-400'
  if (ratio < 0.8) return 'text-yellow-400'
  return 'text-red-400'
}

function getBarColor(ratio: number): string {
  if (ratio < 0.6) return 'bg-green-400'
  if (ratio < 0.8) return 'bg-yellow-400'
  return 'bg-red-400'
}

export function TokenGauge() {
  const activeTab = useTabsStore(selectActiveTab)
  const tokenUsage = activeTab?.tokenUsage
  const [expanded, setExpanded] = useState(false)

  if (!tokenUsage || tokenUsage.sessionTokens === 0) return null

  const tokens = tokenUsage.sessionTokens
  const ratio = Math.min(tokens / ESTIMATED_LIMIT, 1)
  const color = getColor(ratio)

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={`flex items-center gap-1 transition-colors hover:text-white/80 ${color}`}
        title="Token usage this session"
      >
        <Zap size={10} />
        <span>{formatTokens(tokens)}</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full right-0 mb-2 w-52 bg-[var(--bg-secondary)] border border-white/10 rounded-lg p-3 shadow-xl z-50"
          >
            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Session Usage</div>

            {/* Progress bar */}
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full transition-all ${getBarColor(ratio)}`}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px]">
              <span className={color}>{formatTokens(tokens)} used</span>
              <span className="text-white/30">~{formatTokens(ESTIMATED_LIMIT)} limit</span>
            </div>

            <div className="mt-2 pt-2 border-t border-white/5 text-[10px] text-white/20">
              Estimated from CLI output. Actual limits may vary.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
