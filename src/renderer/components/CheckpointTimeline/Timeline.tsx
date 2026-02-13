import { useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
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
  const [selectedHash, setSelectedHash] = useState<string | null>(null)

  const loadCheckpoints = useCallback(async () => {
    if (!currentProject?.path) return
    await window.api.git.init(currentProject.path)
    const log = (await window.api.git.log(50)) as Checkpoint[]
    setCheckpoints(log)
  }, [currentProject?.path])

  useEffect(() => {
    loadCheckpoints()
  }, [loadCheckpoints])

  const createCheckpoint = useCallback(async () => {
    const message = `Checkpoint at ${new Date().toLocaleTimeString()}`
    await window.api.git.checkpoint(message)
    loadCheckpoints()
  }, [loadCheckpoints])

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
        <span className="text-xs text-white/40">{checkpoints.length} checkpoints</span>
        <button
          onClick={createCheckpoint}
          className="flex items-center gap-1 px-3 py-1 bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)] rounded text-xs hover:bg-[var(--accent-cyan)]/30 transition"
        >
          <Plus size={10} /> Checkpoint
        </button>
      </div>

      {/* Horizontal scrollable timeline */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex items-center gap-4 px-4 py-6 min-w-max h-full">
          {checkpoints.map((cp, i) => (
            <motion.button
              key={cp.hash}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedHash(cp.hash === selectedHash ? null : cp.hash)}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition min-w-[120px] ${
                selectedHash === cp.hash
                  ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
                  : 'border-white/10 hover:border-white/20 bg-[var(--bg-tertiary)]'
              }`}
            >
              <GitCommit
                size={16}
                className={selectedHash === cp.hash ? 'text-[var(--accent-cyan)]' : 'text-white/40'}
              />
              <span className="text-[10px] text-white/60 text-center line-clamp-2">
                {cp.message.replace('[checkpoint] ', '')}
              </span>
              <span className="text-[9px] text-white/30">
                {new Date(cp.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}
