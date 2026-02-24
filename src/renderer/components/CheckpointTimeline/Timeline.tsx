import { useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useToastStore } from '@/stores/toast'
import { GitCommit, Plus, RotateCcw, FileText, Info, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Checkpoint {
  hash: string
  message: string
  date: string
  author: string
  filesChanged: number
  insertions: number
  deletions: number
  files: string[]
}

/** Visual diff percentage per checkpoint (compared to previous) */
type DiffMap = Map<string, number | null>

export function Timeline() {
  const { currentProject } = useProjectStore()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [visualDiffs, setVisualDiffs] = useState<DiffMap>(new Map())
  const [showHelp, setShowHelp] = useState(false)
  const diffBeforeHash = useCanvasStore((s) => s.diffBeforeHash)
  const diffAfterHash = useCanvasStore((s) => s.diffAfterHash)
  const setDiffHashes = useCanvasStore((s) => s.setDiffHashes)
  const setActiveTab = useCanvasStore((s) => s.setActiveTab)

  const loadCheckpoints = useCallback(async () => {
    if (!currentProject?.path) return
    await window.api.git.init(currentProject.path)
    const log = (await window.api.git.log(currentProject.path, 50)) as Checkpoint[]
    setCheckpoints(log)
  }, [currentProject?.path])

  useEffect(() => {
    loadCheckpoints()
  }, [loadCheckpoints])

  // Compute visual diffs between adjacent checkpoints
  useEffect(() => {
    if (!currentProject?.path || checkpoints.length < 2) return
    let cancelled = false

    async function computeDiffs() {
      const diffs: DiffMap = new Map()
      for (let i = 0; i < checkpoints.length - 1; i++) {
        const current = checkpoints[i]
        const previous = checkpoints[i + 1]
        const [imgA, imgB] = await Promise.all([
          window.api.screenshot.loadCheckpoint(current.hash, currentProject!.path),
          window.api.screenshot.loadCheckpoint(previous.hash, currentProject!.path),
        ])
        if (cancelled) return
        if (imgA && imgB) {
          const result = await window.api.visualDiff.compare(imgA, imgB)
          if (cancelled) return
          diffs.set(current.hash, result?.diffPercent ?? null)
        } else {
          diffs.set(current.hash, null)
        }
      }
      if (!cancelled) setVisualDiffs(diffs)
    }

    computeDiffs()
    return () => { cancelled = true }
  }, [checkpoints, currentProject?.path])

  // Reload when switching to timeline tab
  const activeCanvasTab = useCanvasStore((s) => s.activeTab)
  useEffect(() => {
    if (activeCanvasTab === 'timeline') loadCheckpoints()
  }, [activeCanvasTab, loadCheckpoints])

  const createCheckpoint = useCallback(async () => {
    if (!currentProject?.path) return
    await window.api.git.init(currentProject.path)
    const message = `Checkpoint at ${new Date().toLocaleTimeString()}`
    const result = await window.api.git.checkpoint(currentProject.path, message)
    if (result?.error === 'nothing-to-commit') {
      useToastStore.getState().addToast('No changes to checkpoint', 'info')
      return
    }
    if (result?.error) {
      useToastStore.getState().addToast(`Checkpoint failed: ${result.error}`, 'error')
      return
    }
    if (result?.hash) {
      await window.api.screenshot.captureCheckpoint(result.hash, currentProject.path)
    }
    useToastStore.getState().addToast('Checkpoint created', 'success')
    loadCheckpoints()
  }, [loadCheckpoints, currentProject?.path])

  const handleClick = useCallback(
    (hash: string) => {
      if (hash === diffBeforeHash) {
        setDiffHashes(null, null)
        return
      }
      if (hash === diffAfterHash) {
        setDiffHashes(diffBeforeHash, null)
        return
      }
      if (!diffBeforeHash) {
        setDiffHashes(hash, null)
        return
      }
      setDiffHashes(diffBeforeHash, hash)
      setActiveTab('diff')
    },
    [diffBeforeHash, diffAfterHash, setDiffHashes, setActiveTab]
  )

  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null)

  const handleRollback = useCallback(async (hash: string, message: string) => {
    if (!currentProject?.path) return
    setRollbackTarget(hash)
    const result = await window.api.git.rollback(currentProject.path, hash)
    setRollbackTarget(null)
    if (result.success) {
      useToastStore.getState().addToast(`Rolled back to: ${message}`, 'success')
      loadCheckpoints()
    } else {
      useToastStore.getState().addToast(`Rollback failed: ${result.error}`, 'error')
    }
  }, [currentProject?.path, loadCheckpoints])

  const getSelectionState = (hash: string): 'before' | 'after' | null => {
    if (hash === diffBeforeHash) return 'before'
    if (hash === diffAfterHash) return 'after'
    return null
  }

  // Reverse so oldest is on the left, newest on the right (natural timeline order)
  const timelineOrder = [...checkpoints].reverse()

  if (checkpoints.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-3">
          <p>No checkpoints yet</p>
          <button
            onClick={createCheckpoint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)] rounded-lg text-xs hover:bg-[var(--accent-cyan)]/30 transition"
          >
            <Plus size={12} /> Create first checkpoint
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/40">{checkpoints.length} checkpoints</span>
          {diffBeforeHash && !diffAfterHash && (
            <span className="text-[10px] text-amber-400/80 animate-pulse">
              Select &quot;After&quot; checkpoint...
            </span>
          )}
          {diffBeforeHash && diffAfterHash && (
            <button
              onClick={() => setDiffHashes(null, null)}
              className="text-[10px] text-white/40 hover:text-white/60 transition"
            >
              Clear selection
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="p-1 rounded hover:bg-white/5 text-white/30 hover:text-white/50 transition"
            title="How to use the timeline"
          >
            <Info size={13} />
          </button>
          {diffBeforeHash && diffAfterHash && (
            <button
              onClick={() => setActiveTab('diff')}
              className="flex items-center gap-1 px-3 py-1 bg-amber-500/20 text-amber-400 rounded text-xs hover:bg-amber-500/30 transition"
            >
              View Diff
            </button>
          )}
          <button
            onClick={createCheckpoint}
            className="flex items-center gap-1 px-3 py-1 bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)] rounded text-xs hover:bg-[var(--accent-cyan)]/30 transition"
          >
            <Plus size={10} /> Checkpoint
          </button>
        </div>
      </div>

      {/* Help banner */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/5"
          >
            <div className="px-4 py-3 bg-[var(--accent-cyan)]/5 flex gap-3">
              <div className="flex-1 space-y-1.5">
                <p className="text-xs font-medium text-[var(--accent-cyan)]">Timeline &mdash; Track your project&apos;s evolution</p>
                <ul className="text-[11px] text-white/50 space-y-1 leading-relaxed">
                  <li><span className="text-white/70">Save snapshots</span> &mdash; Click <strong>+ Checkpoint</strong> to save the current state. Do this before and after major changes.</li>
                  <li><span className="text-white/70">Compare changes</span> &mdash; Click any two checkpoints to select &quot;Before&quot; and &quot;After&quot;, then view a visual diff.</li>
                  <li><span className="text-white/70">Undo mistakes</span> &mdash; Hover a checkpoint and click <strong>Rollback</strong> to restore your project to that exact state.</li>
                  <li><span className="text-white/70">Tip:</span> Create checkpoints frequently &mdash; before trying risky changes, after completing features, or whenever things &quot;work&quot;.</li>
                </ul>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="self-start p-0.5 rounded hover:bg-white/10 text-white/30 hover:text-white/50 transition"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Horizontal scrollable timeline — oldest left, newest right */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex items-stretch gap-0 px-4 py-6 min-w-max h-full">
          {timelineOrder.map((cp, i) => {
            const sel = getSelectionState(cp.hash)
            const isLatest = i === timelineOrder.length - 1
            const cleanMessage = cp.message.replace('[checkpoint] ', '')

            let borderColor: string
            let iconColor: string
            if (sel === 'before') {
              borderColor = 'border-amber-400 bg-amber-400/10'
              iconColor = 'text-amber-400'
            } else if (sel === 'after') {
              borderColor = 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
              iconColor = 'text-[var(--accent-cyan)]'
            } else {
              borderColor = 'border-white/10 hover:border-white/20 bg-[var(--bg-tertiary)]'
              iconColor = 'text-white/40'
            }

            return (
              <div key={cp.hash} className="flex items-center">
                {/* Connector line between cards */}
                {i > 0 && (
                  <div className="w-6 h-px bg-white/10 flex-shrink-0" />
                )}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => handleClick(cp.hash)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(cp.hash) }}
                  className={`group relative flex flex-col gap-1.5 p-3 rounded-lg border transition w-[180px] cursor-pointer flex-shrink-0 ${borderColor}`}
                >
                  {/* Selection badge */}
                  {sel && (
                    <span
                      className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                        sel === 'before'
                          ? 'bg-amber-400 text-black'
                          : 'bg-[var(--accent-cyan)] text-black'
                      }`}
                    >
                      {sel === 'before' ? 'Before' : 'After'}
                    </span>
                  )}

                  {/* Latest badge */}
                  {isLatest && !sel && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-green-500/80 text-black">
                      Latest
                    </span>
                  )}

                  {/* Header: icon + message */}
                  <div className="flex items-start gap-2">
                    <GitCommit size={14} className={`${iconColor} mt-0.5 flex-shrink-0`} />
                    <span className="text-[11px] text-white/70 leading-tight line-clamp-2 font-medium">
                      {cleanMessage}
                    </span>
                  </div>

                  {/* Stats row */}
                  {(cp.filesChanged > 0 || cp.insertions > 0 || cp.deletions > 0) && (
                    <div className="flex items-center gap-2 text-[9px] font-mono ml-[22px]">
                      <span className="text-white/30">{cp.filesChanged} file{cp.filesChanged !== 1 ? 's' : ''}</span>
                      {cp.insertions > 0 && (
                        <span className="text-green-400">+{cp.insertions}</span>
                      )}
                      {cp.deletions > 0 && (
                        <span className="text-red-400">-{cp.deletions}</span>
                      )}
                    </div>
                  )}

                  {/* File list */}
                  {cp.files.length > 0 && (
                    <div className="ml-[22px] space-y-0.5">
                      {cp.files.map((file) => (
                        <div key={file} className="flex items-center gap-1 text-[9px] text-white/25 truncate">
                          <FileText size={8} className="flex-shrink-0" />
                          <span className="truncate">{file.split('/').pop()}</span>
                        </div>
                      ))}
                      {cp.filesChanged > 5 && (
                        <span className="text-[9px] text-white/20 ml-3">
                          +{cp.filesChanged - 5} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* Visual diff badge */}
                  {visualDiffs.has(cp.hash) && visualDiffs.get(cp.hash) !== null && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded self-start ml-[22px] ${
                      (visualDiffs.get(cp.hash)!) > 5
                        ? 'bg-orange-400/10 text-orange-400'
                        : 'bg-green-400/10 text-green-400'
                    }`}>
                      {visualDiffs.get(cp.hash)!.toFixed(1)}% visual change
                    </span>
                  )}

                  {/* Timestamp + author */}
                  <div className="flex items-center justify-between ml-[22px] mt-0.5">
                    <span className="text-[9px] text-white/25">
                      {new Date(cp.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[9px] text-white/20 truncate max-w-[60px]">{cp.author}</span>
                  </div>

                  {/* Rollback button */}
                  {rollbackTarget === cp.hash ? (
                    <span className="text-[9px] text-yellow-400 animate-pulse ml-[22px]">Rolling back...</span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Rollback to "${cleanMessage}"?\nThis will discard all changes after this point.`)) {
                          handleRollback(cp.hash, cp.message)
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[9px] text-white/30 hover:text-orange-400 transition-all ml-[22px]"
                      title="Rollback to this checkpoint"
                    >
                      <RotateCcw size={9} /> Rollback
                    </button>
                  )}

                  {/* Short hash */}
                  <span className="text-[8px] text-white/15 font-mono ml-[22px]">{cp.hash.slice(0, 7)}</span>
                </motion.div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
