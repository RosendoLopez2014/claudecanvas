import { Minus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ServiceIcons } from '../ServiceIcons/ServiceIcons'
import { useProjectStore } from '@/stores/project'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const platform = window.api.platform
  const screen = useProjectStore((s) => s.screen)

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
  }, [])

  const handleMinimize = useCallback(() => window.api.window.minimize(), [])
  const handleMaximize = useCallback(async () => {
    window.api.window.maximize()
    setIsMaximized(await window.api.window.isMaximized())
  }, [])
  const handleClose = useCallback(() => window.api.window.close(), [])

  return (
    <div className="h-10 flex items-center justify-between border-b border-white/10 bg-[var(--bg-primary)] drag-region select-none">
      {/* Left: macOS traffic lights get space, or app title on Windows */}
      <div className="flex items-center gap-2 pl-20">
        <span className="text-xs font-medium text-white/50 no-drag">Claude Canvas</span>
      </div>

      {/* Center/Right: Service icons (only in workspace) + Windows controls */}
      <div className="flex items-center gap-2">
        {screen === 'workspace' && <ServiceIcons />}
      </div>

      {/* Right: Windows controls (hidden on macOS) */}
      {platform !== 'darwin' && (
        <div className="flex no-drag">
          <button
            onClick={handleMinimize}
            className="h-10 w-12 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <Minus size={14} className="text-white/60" />
          </button>
          <button
            onClick={handleMaximize}
            className="h-10 w-12 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <Square size={12} className="text-white/60" />
          </button>
          <button
            onClick={handleClose}
            className="h-10 w-12 flex items-center justify-center hover:bg-red-500/80 transition-colors"
          >
            <X size={14} className="text-white/60" />
          </button>
        </div>
      )}
    </div>
  )
}
