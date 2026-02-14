import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw, X } from 'lucide-react'
import { useProjectStore } from '@/stores/project'
import { useWorkspaceStore } from '@/stores/workspace'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

const FILE_ICONS: Record<string, string> = {
  ts: 'text-blue-400',
  tsx: 'text-blue-300',
  js: 'text-yellow-400',
  jsx: 'text-yellow-300',
  css: 'text-purple-400',
  json: 'text-green-400',
  md: 'text-white/50',
  html: 'text-orange-400',
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop() || ''
  return FILE_ICONS[ext] || 'text-white/40'
}

function TreeNode({ node, depth, onFileClick }: { node: FileNode; depth: number; onFileClick: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 1)

  if (node.type === 'file') {
    return (
      <button
        onClick={() => onFileClick(node.path)}
        className="w-full flex items-center gap-1.5 py-0.5 px-2 text-left hover:bg-white/5 transition-colors group"
        style={{ paddingLeft: depth * 12 + 8 }}
        title={node.path}
      >
        <File size={12} className={getFileColor(node.name)} />
        <span className="text-[11px] text-white/60 group-hover:text-white/80 truncate">{node.name}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 py-0.5 px-2 text-left hover:bg-white/5 transition-colors"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {expanded ? <ChevronDown size={10} className="text-white/30" /> : <ChevronRight size={10} className="text-white/30" />}
        {expanded ? <FolderOpen size={12} className="text-[var(--accent-cyan)]" /> : <Folder size={12} className="text-white/40" />}
        <span className="text-[11px] text-white/70 truncate">{node.name}</span>
      </button>
      {expanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
      ))}
    </div>
  )
}

export function FileExplorer() {
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const projectPath = useProjectStore((s) => s.currentProject?.path)
  const toggleFileExplorer = useWorkspaceStore((s) => s.toggleFileExplorer)

  const loadTree = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const nodes = await window.api.fs.tree(projectPath, 4)
      setTree(nodes as FileNode[])
    } catch {
      setTree([])
    }
    setLoading(false)
  }, [projectPath])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  // Refresh on file changes
  useEffect(() => {
    const removeAdd = window.api.fs.onAdd(() => loadTree())
    const removeUnlink = window.api.fs.onUnlink(() => loadTree())
    return () => { removeAdd(); removeUnlink() }
  }, [loadTree])

  const handleFileClick = useCallback((filePath: string) => {
    // Copy relative path to clipboard and paste into terminal
    const relative = projectPath ? filePath.replace(projectPath + '/', '') : filePath
    navigator.clipboard.writeText(relative)

    // Also write to active PTY as a comment
    const { activeTabId } = (window as any).__tabsStore?.getState?.() || {}
    if (activeTabId) {
      window.api.pty.write(activeTabId, relative)
    }
  }, [projectPath])

  return (
    <div className="h-full flex flex-col bg-[var(--bg-secondary)] border-r border-white/10" style={{ width: 220 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-[11px] text-white/50 uppercase tracking-wider font-semibold">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={loadTree}
            className="p-0.5 hover:bg-white/10 rounded transition"
            title="Refresh"
          >
            <RefreshCw size={11} className={`text-white/30 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={toggleFileExplorer}
            className="p-0.5 hover:bg-white/10 rounded transition"
            title="Close explorer (⌘B)"
          >
            <X size={11} className="text-white/30" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto py-1">
        {loading && tree.length === 0 ? (
          <div className="px-3 py-4 text-center text-[10px] text-white/20">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-4 text-center text-[10px] text-white/20">No files</div>
        ) : (
          tree.map((node) => (
            <TreeNode key={node.path} node={node} depth={0} onFileClick={handleFileClick} />
          ))
        )}
      </div>
    </div>
  )
}
