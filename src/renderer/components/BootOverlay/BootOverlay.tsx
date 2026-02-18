import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTabsStore } from '@/stores/tabs'
import { Terminal, Radio, Sparkles, Check, Loader2 } from 'lucide-react'

const FEATURES = ['Canvas', 'Gallery', 'Timeline', 'Inspector', 'Preview']

interface BootStep {
  key: string
  label: string
  icon: React.ReactNode
  done: boolean
}

interface BootOverlayProps {
  tabId: string
  projectName: string
}

export function BootOverlay({ tabId, projectName }: BootOverlayProps) {
  const boot = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    return tab?.boot ?? { ptyReady: false, mcpReady: false, claudeReady: false }
  })

  const [dismissed, setDismissed] = useState(false)
  const [showReady, setShowReady] = useState(false)

  const allDone = boot.ptyReady && boot.mcpReady && boot.claudeReady

  // When all steps complete, show "Ready" briefly then dismiss
  useEffect(() => {
    if (!allDone) return
    const readyTimer = setTimeout(() => setShowReady(true), 200)
    const dismissTimer = setTimeout(() => setDismissed(true), 800)
    return () => {
      clearTimeout(readyTimer)
      clearTimeout(dismissTimer)
    }
  }, [allDone])

  const steps: BootStep[] = useMemo(() => [
    {
      key: 'pty',
      label: 'Terminal',
      icon: <Terminal size={14} />,
      done: boot.ptyReady,
    },
    {
      key: 'mcp',
      label: 'MCP bridge',
      icon: <Radio size={14} />,
      done: boot.mcpReady,
    },
    {
      key: 'claude',
      label: 'Claude Code',
      icon: <Sparkles size={14} />,
      done: boot.claudeReady,
    },
  ], [boot.ptyReady, boot.mcpReady, boot.claudeReady])

  // Calculate progress percentage
  const doneCount = steps.filter((s) => s.done).length
  const progress = showReady ? 100 : (doneCount / (steps.length + 1)) * 100

  if (dismissed) return null

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          key="boot-overlay"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-primary)' }}
        >
          <div className="flex flex-col items-center gap-8 w-[320px]">
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
                // Active = first undone step
                const isActive = !step.done && steps.slice(0, i).every((s) => s.done)
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
                            : isActive
                              ? 'text-white/60'
                              : 'text-white/20'
                        }
                      >
                        {step.icon}
                      </div>
                      <span
                        className={`text-sm font-mono ${
                          step.done
                            ? 'text-white/70'
                            : isActive
                              ? 'text-white/50'
                              : 'text-white/20'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    <div className="flex items-center">
                      {step.done ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                        >
                          <Check size={14} className="text-[var(--accent-cyan)]" />
                        </motion.div>
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
