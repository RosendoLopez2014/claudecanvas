import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { GitBranch, Circle, Eye } from 'lucide-react'

export function StatusBar() {
  const { currentProject, isDevServerRunning } = useProjectStore()
  const { inspectorActive, setInspectorActive } = useCanvasStore()

  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[var(--bg-secondary)] border-t border-white/10 text-[11px] text-white/50">
      <div className="flex items-center gap-3">
        {currentProject && (
          <>
            <span className="text-white/70">{currentProject.name}</span>
            <div className="flex items-center gap-1">
              <GitBranch size={11} />
              <span>main</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isDevServerRunning && (
          <div className="flex items-center gap-1">
            <Circle size={6} className="fill-green-400 text-green-400" />
            <span>Dev server running</span>
          </div>
        )}
        <button
          onClick={() => setInspectorActive(!inspectorActive)}
          className={`flex items-center gap-1 hover:text-white/80 transition-colors ${
            inspectorActive ? 'text-[var(--accent-cyan)]' : ''
          }`}
        >
          <Eye size={11} />
          <span>Inspector</span>
        </button>
      </div>
    </div>
  )
}
