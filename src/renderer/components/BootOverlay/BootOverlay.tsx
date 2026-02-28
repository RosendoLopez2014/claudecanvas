import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTabsStore } from '@/stores/tabs'
import { Terminal, Radio, Sparkles, Check, Loader2, AlertTriangle, RotateCcw } from 'lucide-react'

const FEATURES = ['Canvas', 'Gallery', 'Timeline', 'Inspector', 'Preview']
const DEFAULT_BOOT = { ptyReady: false as boolean | 'error', mcpReady: false as boolean | 'error', claudeReady: false as boolean | 'error' }

interface BootStep {
  key: string
  label: string
  icon: React.ReactNode
  done: boolean
  error: boolean
}

interface BootOverlayProps {
  tabId: string
  projectName: string
}

export function BootOverlay({ tabId, projectName }: BootOverlayProps) {
  const boot = useTabsStore(
    (s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      return tab?.boot ?? DEFAULT_BOOT
    },
    (a, b) => a.ptyReady === b.ptyReady && a.mcpReady === b.mcpReady && a.claudeReady === b.claudeReady
  )

  const allDone = boot.ptyReady === true && boot.mcpReady === true && boot.claudeReady === true
  const hasError = boot.ptyReady === 'error' || boot.mcpReady === 'error' || boot.claudeReady === 'error'

  // Start dismissed if boot already completed (e.g. tab switch back)
  const [dismissed, setDismissed] = useState(allDone)
  const [showReady, setShowReady] = useState(false)

  const dismiss = useCallback(() => setDismissed(true), [])

  // When all steps complete, show "Ready" briefly then dismiss
  useEffect(() => {
    if (!allDone) return
    const readyTimer = setTimeout(() => setShowReady(true), 200)
    const dismissTimer = setTimeout(dismiss, 800)
    return () => {
      clearTimeout(readyTimer)
      clearTimeout(dismissTimer)
    }
  }, [allDone, dismiss])

  // Escape key or click to dismiss early
  useEffect(() => {
    if (dismissed) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dismissed, dismiss])

  const steps: BootStep[] = useMemo(() => [
    {
      key: 'pty',
      label: boot.ptyReady === 'error' ? 'Terminal (failed)' : 'Terminal',
      icon: <Terminal size={14} />,
      done: boot.ptyReady === true,
      error: boot.ptyReady === 'error',
    },
    {
      key: 'mcp',
      label: boot.mcpReady === 'error' ? 'MCP bridge (failed)' : 'MCP bridge',
      icon: <Radio size={14} />,
      done: boot.mcpReady === true,
      error: boot.mcpReady === 'error',
    },
    {
      key: 'claude',
      label: boot.claudeReady === 'error' ? 'Claude Code (failed)' : 'Claude Code',
      icon: <Sparkles size={14} />,
      done: boot.claudeReady === true,
      error: boot.claudeReady === 'error',
    },
  ], [boot.ptyReady, boot.mcpReady, boot.claudeReady])

  // Calculate progress percentage (errors count as "resolved" for progress but not for ready)
  const doneCount = steps.filter((s) => s.done).length
  const resolvedCount = steps.filter((s) => s.done || s.error).length
  const progress = showReady ? 100 : hasError ? (resolvedCount / steps.length) * 80 : (doneCount / (steps.length + 1)) * 100

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          key="boot-overlay"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="absolute inset-0 z-20 flex items-center justify-center cursor-pointer"
          style={{ backgroundColor: 'var(--bg-primary)' }}
          onClick={dismiss}
        >
          <div
            className="flex flex-col items-center gap-8 w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Logo */}
            <div className="text-center">
              <h1 className="text-xl font-bold bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-coral)] bg-clip-text text-transparent">
                Claude Canvas
              </h1>
              <p className="text-white/40 text-sm mt-1 font-mono">{projectName}</p>
            </div>

            {/* Steps */}
            <div className="w-full space-y-3">
              {steps.map((step, i) => {
                // Active = first undone step (that isn't errored)
                const isActive = !step.done && !step.error && steps.slice(0, i).every((s) => s.done || s.error)
                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1, duration: 0.3 }}
                    className="flex items-center justify-between px-4 py-2 rounded-lg"
                    style={{
                      backgroundColor: step.done
                        ? 'rgba(74, 234, 255, 0.05)'
                        : step.error
                          ? 'rgba(239, 68, 68, 0.08)'
                          : isActive
                            ? 'rgba(255, 255, 255, 0.03)'
                            : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={
                          step.done
                            ? 'text-[var(--accent-cyan)]'
                            : step.error
                              ? 'text-red-400'
                              : isActive
                                ? 'text-white/60'
                                : 'text-white/20'
                        }
                      >
                        {step.error ? <AlertTriangle size={14} /> : step.icon}
                      </div>
                      <span
                        className={`text-sm font-mono ${
                          step.done
                            ? 'text-white/70'
                            : step.error
                              ? 'text-red-400'
                              : isActive
                                ? 'text-white/50'
                                : 'text-white/20'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {step.error && step.key === 'mcp' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            useTabsStore.getState().retryMcp(tabId)
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
                        >
                          <RotateCcw size={10} />
                          Retry
                        </button>
                      )}
                      {step.done ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                        >
                          <Check size={14} className="text-[var(--accent-cyan)]" />
                        </motion.div>
                      ) : step.error ? (
                        <AlertTriangle size={14} className="text-red-400" />
                      ) : isActive ? (
                        <Loader2 size={14} className="text-white/40 animate-spin" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-white/10" />
                      )}
                    </div>
                  </motion.div>
                )
              })}

              {/* Ready row */}
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: showReady ? 1 : 0.3, x: 0 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                className="flex items-center justify-between px-4 py-2 rounded-lg"
                style={{
                  backgroundColor: showReady ? 'rgba(74, 234, 255, 0.08)' : 'transparent',
                }}
              >
                <div className="flex items-center gap-3">
                  <Sparkles
                    size={14}
                    className={showReady ? 'text-[var(--accent-cyan)]' : 'text-white/20'}
                  />
                  <span
                    className={`text-sm font-mono ${
                      showReady ? 'text-[var(--accent-cyan)] font-medium' : 'text-white/20'
                    }`}
                  >
                    Ready
                  </span>
                </div>
                {showReady && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <Check size={14} className="text-[var(--accent-cyan)]" />
                  </motion.div>
                )}
              </motion.div>
            </div>

            {/* Progress bar */}
            <div className="w-full px-4">
              <div className="h-[3px] w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-coral))',
                  }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Feature tags */}
            <div className="flex items-center gap-3 flex-wrap justify-center">
              {FEATURES.map((feature, i) => (
                <motion.span
                  key={feature}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
                  className="text-[11px] font-mono text-white/15 tracking-wide"
                >
                  {feature}
                </motion.span>
              ))}
            </div>

            {/* Skip hint */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5, duration: 0.5 }}
              onClick={dismiss}
              className="text-[10px] text-white/15 hover:text-white/40 transition-colors font-mono"
            >
              press esc to skip
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
