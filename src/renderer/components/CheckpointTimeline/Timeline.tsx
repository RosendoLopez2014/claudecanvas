import { useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useToastStore } from '@/stores/toast'
import { GitCommit, Plus } from 'lucide-react'
import { motion } from 'framer-motion'

interface Checkpoint {
  hash: string
  message: string
  date: string
  author: string
}

export function Timeline() {
  const { currentProject } = useProjectStore()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
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
                className={`relative flex flex-col items-center gap-2 p-3 rounded-lg border transition min-w-[120px] ${borderColor}`}
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
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
