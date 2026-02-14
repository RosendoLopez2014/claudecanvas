import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { GitBranch, FolderPlus, Plus, Loader2, ArrowLeft } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'

interface NewTabMenuProps {
  onClose: () => void
}

export function NewTabMenu({ onClose }: NewTabMenuProps) {
  const activeTab = useTabsStore((s) => s.getActiveTab())
  const [mode, setMode] = useState<'menu' | 'new-branch' | 'existing-branch'>('menu')
  const [branchName, setBranchName] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Focus input when switching to new-branch mode
  useEffect(() => {
    if (mode === 'new-branch') inputRef.current?.focus()
  }, [mode])

  const handleNewBranch = useCallback(async () => {
    if (!activeTab || !branchName.trim() || loading) return
    setLoading(true)
    const name = branchName.trim().replace(/\s+/g, '-')
    const targetDir = `${activeTab.project.path}/../${activeTab.project.name}-${name}`
    try {
      const result = await window.api.worktree.create({
        projectPath: activeTab.project.path,
        branchName: name,
        targetDir,
      })
      const tabId = useTabsStore.getState().addTab({
        name: activeTab.project.name,
        path: result.path,
      })
      useTabsStore.getState().updateTab(tabId, {
        worktreeBranch: result.branch,
        worktreePath: result.path,
      })
      useToastStore.getState().addToast(`Created worktree: ${name}`, 'success')
      onClose()
    } catch (err: any) {
      useToastStore.getState().addToast(`Failed: ${err?.message || err}`, 'error')
    }
    setLoading(false)
  }, [activeTab, branchName, loading, onClose])

  const loadBranches = useCallback(async () => {
    if (!activeTab) return
    setMode('existing-branch')
    setLoading(true)
    try {
      const result = await window.api.worktree.branches(activeTab.project.path)
      setBranches(result.branches.filter((b: string) => b !== result.current))
    } catch (err: any) {
      useToastStore.getState().addToast(`Failed to list branches: ${err?.message}`, 'error')
    }
    setLoading(false)
  }, [activeTab])

  const handleCheckoutBranch = useCallback(async (branch: string) => {
    if (!activeTab || loading) return
    setLoading(true)
    const targetDir = `${activeTab.project.path}/../${activeTab.project.name}-${branch}`
    try {
      const result = await window.api.worktree.checkout({
        projectPath: activeTab.project.path,
        branchName: branch,
        targetDir,
      })
      const tabId = useTabsStore.getState().addTab({
        name: activeTab.project.name,
        path: result.path,
      })
      useTabsStore.getState().updateTab(tabId, {
        worktreeBranch: result.branch,
        worktreePath: result.path,
      })
      useToastStore.getState().addToast(`Opened worktree: ${branch}`, 'success')
      onClose()
    } catch (err: any) {
      useToastStore.getState().addToast(`Failed: ${err?.message || err}`, 'error')
    }
    setLoading(false)
  }, [activeTab, loading, onClose])

  const handleDifferentProject = useCallback(() => {
    onClose()
    useProjectStore.getState().setScreen('project-picker')
  }, [onClose])

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
      className="absolute top-full mt-1 w-64 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[100] overflow-hidden"
    >
      {mode === 'menu' && (
        <>
          <button onClick={() => setMode('new-branch')} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white/70 hover:bg-white/5 transition-colors">
            <Plus size={12} className="text-[var(--accent-cyan)]" />
            New branch (worktree)
          </button>
          <button onClick={loadBranches} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white/70 hover:bg-white/5 transition-colors">
            <GitBranch size={12} />
            Existing branch
          </button>
          <div className="border-t border-white/5" />
          <button onClick={handleDifferentProject} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white/70 hover:bg-white/5 transition-colors">
            <FolderPlus size={12} />
            Different project
          </button>
        </>
      )}

      {mode === 'new-branch' && (
        <div className="p-3 space-y-2">
          <button onClick={() => setMode('menu')} className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 mb-1">
            <ArrowLeft size={10} /> Back
          </button>
          <input
            ref={inputRef}
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNewBranch()}
            placeholder="feature/my-feature"
            className="w-full px-2.5 py-1.5 bg-[var(--bg-primary)] border border-white/10 rounded text-xs text-white placeholder-white/20 focus:outline-none focus:border-[var(--accent-cyan)]/50"
          />
          <button
            onClick={handleNewBranch}
            disabled={!branchName.trim() || loading}
            className="w-full py-1.5 text-xs bg-[var(--accent-cyan)] text-black rounded font-medium disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin mx-auto" /> : 'Create & Open'}
          </button>
        </div>
      )}

      {mode === 'existing-branch' && (
        <div className="p-2">
          <button onClick={() => setMode('menu')} className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 mb-2 px-1">
            <ArrowLeft size={10} /> Back
          </button>
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 size={14} className="animate-spin text-white/30" />
            </div>
          ) : branches.length === 0 ? (
            <div className="text-xs text-white/30 text-center py-3">No other branches</div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {branches.map((b) => (
                <button
                  key={b}
                  onClick={() => handleCheckoutBranch(b)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-white/60 hover:bg-white/5 rounded transition-colors text-left"
                >
                  <GitBranch size={10} className="shrink-0" />
                  <span className="truncate">{b}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
