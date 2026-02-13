import { useState, useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { ArrowLeftRight } from 'lucide-react'

interface DiffViewProps {
  beforeHash?: string
  afterHash?: string
}

export function DiffView({ beforeHash, afterHash }: DiffViewProps) {
  const { previewUrl } = useCanvasStore()
  const [diffText, setDiffText] = useState<string>('')
  const [mode, setMode] = useState<'visual' | 'text'>('visual')

  useEffect(() => {
    if (beforeHash) {
      window.api.git.diff(beforeHash).then(setDiffText)
    }
  }, [beforeHash])

  if (!previewUrl && !diffText) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-2">
          <ArrowLeftRight size={24} className="mx-auto text-white/20" />
          <p>Select two checkpoints to compare</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <button
          onClick={() => setMode('visual')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'visual' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
          }`}
        >
          Visual
        </button>
        <button
          onClick={() => setMode('text')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'text' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
          }`}
        >
          Text Diff
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'visual' && previewUrl ? (
          <div className="h-full flex">
            {/* Before */}
            <div className="flex-1 border-r border-white/10 flex flex-col">
              <div className="px-3 py-1.5 text-[10px] text-white/40 bg-[var(--bg-tertiary)] border-b border-white/10">
                Before {beforeHash ? `(${beforeHash.slice(0, 7)})` : ''}
              </div>
              <div className="flex-1 bg-white">
                <iframe
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Before"
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>
            </div>
            {/* After */}
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-1.5 text-[10px] text-white/40 bg-[var(--bg-tertiary)] border-b border-white/10">
                After {afterHash ? `(${afterHash.slice(0, 7)})` : '(current)'}
              </div>
              <div className="flex-1 bg-white">
                <iframe
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="After"
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto p-4">
            <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap">
              {diffText || 'No diff available'}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
