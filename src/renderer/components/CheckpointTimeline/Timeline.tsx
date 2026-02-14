import { useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useToastStore } from '@/stores/toast'
import { GitCommit, Plus, RotateCcw } from 'lucide-react'
import { motion } from 'framer-motion'

interface Checkpoint {
  hash: string
  message: string
  date: string
  author: string
}

/** Visual diff percentage per checkpoint (compared to previous) */
type DiffMap = Map<string, number | null>

export function Timeline() {
  const { currentProject } = useProjectStore()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [visualDiffs, setVisualDiffs] = useState<DiffMap>(new Map())
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
      // Compare each checkpoint to the one before it (older)
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
  const activeTab = useCanvasStore((s) => s.activeTab)
  useEffect(() => {
    if (activeTab === 'timeline') loadCheckpoints()
  }, [activeTab, loadCheckpoints])

  const createCheckpoint = useCallback(async () => {
    if (!currentProject?.path) return
    // Ensure git is initialized
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
    // Capture screenshot for visual diff
    if (result?.hash) {
      await window.api.screenshot.captureCheckpoint(result.hash, currentProject.path)
    }
    useToastStore.getState().addToast('Checkpoint created', 'success')
    loadCheckpoints()
  }, [loadCheckpoints, currentProject?.path])

  const handleClick = useCallback(
    (hash: string) => {
      // Clicking the "before" checkpoint deselects it
      if (hash === diffBeforeHash) {
        setDiffHashes(null, null)
        return
      }
      // Clicking the "after" checkpoint deselects just the after
      if (hash === diffAfterHash) {
        setDiffHashes(diffBeforeHash, null)
        return
      }
      // No before selected yet — set as before
      if (!diffBeforeHash) {
        setDiffHashes(hash, null)
        return
      }
      // Before is set, no after yet — set as after and switch to diff tab
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

      {/* Horizontal scrollable timeline */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex items-center gap-4 px-4 py-6 min-w-max h-full">
          {checkpoints.map((cp, i) => {
            const sel = getSelectionState(cp.hash)
            const borderColor =
              sel === 'before'
                ? 'border-amber-400 bg-amber-400/10'
                : sel === 'after'
                  ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
                  : 'border-white/10 hover:border-white/20 bg-[var(--bg-tertiary)]'
            const iconColor =
              sel === 'before'
                ? 'text-amber-400'
                : sel === 'after'
                  ? 'text-[var(--accent-cyan)]'
                  : 'text-white/40'

            return (
              <motion.button
                key={cp.hash}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => handleClick(cp.hash)}
                className={`group relative flex flex-col items-center gap-2 p-3 rounded-lg border transition min-w-[120px] ${borderColor}`}
              >
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
                <GitCommit size={16} className={iconColor} />
                <span className="text-[10px] text-white/60 text-center line-clamp-2">
                  {cp.message.replace('[checkpoint] ', '')}
                </span>
                <span className="text-[9px] text-white/30">
                  {new Date(cp.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {visualDiffs.has(cp.hash) && visualDiffs.get(cp.hash) !== null && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    (visualDiffs.get(cp.hash)!) > 5
                      ? 'bg-orange-400/10 text-orange-400'
                      : 'bg-green-400/10 text-green-400'
                  }`}>
                    {visualDiffs.get(cp.hash)!.toFixed(1)}% diff
                  </span>
                )}
                {/* Rollback button - confirm on click */}
                {rollbackTarget === cp.hash ? (
                  <span className="text-[9px] text-yellow-400 animate-pulse">Rolling back...</span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Rollback to "${cp.message.replace('[checkpoint] ', '')}"?\nThis will discard all changes after this point.`)) {
                        handleRollback(cp.hash, cp.message)
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[9px] text-white/30 hover:text-orange-400 transition-all"
                    title="Rollback to this checkpoint"
                  >
                    <RotateCcw size={9} /> Rollback
                  </button>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
