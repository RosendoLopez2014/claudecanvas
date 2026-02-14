import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Loader2, ArrowUpRight } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'

interface PushPopoverProps {
  onClose: () => void
}

export function PushPopover({ onClose }: PushPopoverProps) {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(true)
  const [pushing, setPushing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const tab = useTabsStore((s) => s.getActiveTab())
  const projectPath = tab?.project.path

  // Generate AI commit message on mount
  useEffect(() => {
    if (!projectPath) return
    setGenerating(true)
    window.api.git.generateCommitMessage(projectPath).then((msg) => {
      setMessage(msg || '')
      setGenerating(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    })
  }, [projectPath])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handlePush = useCallback(async () => {
    if (!projectPath || !message.trim() || pushing) return
    setPushing(true)
    const { addToast } = useToastStore.getState()

    const result = await window.api.git.squashAndPush(projectPath, message.trim())

    if (result.success) {
      const branch = result.branch
      const isMain = branch === 'main' || branch === 'master'

      // Refresh sync counts
      const counts = await window.api.git.fetch(projectPath)
      if (tab) {
        useTabsStore.getState().updateTab(tab.id, {
          gitAhead: counts.ahead || 0,
          gitBehind: counts.behind || 0,
          gitSyncing: false,
        })
      }

      if (isMain) {
        addToast(`Pushed to origin/${branch}`, 'success')
      } else {
        addToast(`Pushed to origin/${branch}`, 'success', {
          duration: 6000,
          action: {
            label: 'Create PR',
            onClick: async () => {
              // Generate PR body
              let body = ''
              try {
                body = await window.api.git.generateCommitMessage(projectPath)
              } catch {}
              const prResult = await window.api.git.createPr(projectPath, {
                title: message.trim(),
                body,
                base: 'main',
              })
              if ('url' in prResult) {
                addToast(`PR #${prResult.number} created`, 'success', {
                  duration: 6000,
                  action: {
                    label: 'Open',
                    onClick: () => window.open(prResult.url, '_blank'),
                  },
                })
              } else {
                addToast(`PR failed: ${prResult.error}`, 'error')
              }
            },
          },
        })
      }
      onClose()
    } else {
      if ('needsPull' in result && result.needsPull) {
        addToast('Push rejected — pulling changes first...', 'info')
        const pullResult = await window.api.git.pull(projectPath)
        if (pullResult.success && !pullResult.conflicts) {
          // Retry push
          const retryResult = await window.api.git.squashAndPush(projectPath, message.trim())
          if (retryResult.success) {
            addToast(`Pushed to origin/${retryResult.branch}`, 'success')
            onClose()
            return
          }
        } else if (pullResult.conflicts) {
          addToast('Conflicts detected — resolve in terminal', 'error')
        }
      } else {
        addToast(`Push failed: ${result.error}`, 'error')
      }
      setPushing(false)
    }
  }, [projectPath, message, pushing, tab, onClose])

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.12 }}
      className="absolute bottom-full mb-2 right-0 w-72 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[200] p-3"
    >
      <div className="text-[11px] text-white/40 mb-2">Commit message</div>
      <input
        ref={inputRef}
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handlePush()}
        placeholder={generating ? 'Generating message...' : 'What did you change?'}
        disabled={generating || pushing}
        className="w-full px-2.5 py-1.5 bg-[var(--bg-primary)] border border-white/10 rounded text-xs text-white placeholder-white/20 focus:outline-none focus:border-[var(--accent-cyan)]/50 disabled:opacity-50"
      />
      {generating && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-white/30">
          <Loader2 size={10} className="animate-spin" />
          AI generating...
        </div>
      )}
      <button
        onClick={handlePush}
        disabled={!message.trim() || generating || pushing}
        className="w-full mt-2 py-1.5 text-xs bg-[var(--accent-cyan)] text-black rounded font-medium disabled:opacity-40 flex items-center justify-center gap-1"
      >
        {pushing ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <>
            <ArrowUpRight size={12} />
            Push
          </>
        )}
      </button>
    </motion.div>
  )
}
