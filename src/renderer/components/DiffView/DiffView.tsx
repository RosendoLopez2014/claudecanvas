import { useState, useEffect, useCallback } from 'react'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { ArrowLeftRight, Undo2 } from 'lucide-react'

type DiffMode = 'visual' | 'text'

interface DiffFile {
  header: string
  hunks: DiffHunk[]
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = raw.split('\n')
  let currentFile: DiffFile | null = null
  let currentHunk: DiffHunk | null = null

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      currentFile = { header: line, hunks: [] }
      files.push(currentFile)
      currentHunk = null
    } else if (line.startsWith('@@') && currentFile) {
      currentHunk = { header: line, lines: [] }
      currentFile.hunks.push(currentHunk)
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1) })
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'remove', content: line.slice(1) })
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) || '' })
      }
    }
  }
  return files
}

function extractFilePath(header: string): string {
  // "diff --git a/src/foo.ts b/src/foo.ts" → "src/foo.ts"
  const match = header.match(/b\/(.+)$/)
  return match?.[1] || header
}

export function DiffView() {
  const currentTab = useTabsStore(selectActiveTab)
  const diffBeforeHash = currentTab?.diffBeforeHash ?? null
  const diffAfterHash = currentTab?.diffAfterHash ?? null
  const previewUrl = currentTab?.previewUrl ?? null
  const currentProject = useProjectStore((s) => s.currentProject)

  const [mode, setMode] = useState<DiffMode>('text')
  const [diffText, setDiffText] = useState('')
  const [parsedFiles, setParsedFiles] = useState<DiffFile[]>([])
  const [beforeScreenshot, setBeforeScreenshot] = useState<string | null>(null)
  const [afterScreenshot, setAfterScreenshot] = useState<string | null>(null)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set())

  // Load text diff
  useEffect(() => {
    if (!diffBeforeHash || !currentProject?.path) {
      setDiffText('')
      setParsedFiles([])
      return
    }
    const load = async () => {
      let raw: string
      if (diffAfterHash) {
        raw = await window.api.git.diffBetween(currentProject.path, diffBeforeHash, diffAfterHash)
      } else {
        raw = await window.api.git.diff(currentProject.path, diffBeforeHash)
      }
      setDiffText(raw)
      setParsedFiles(parseDiff(raw))
      setCollapsedFiles(new Set())
    }
    load()
  }, [diffBeforeHash, diffAfterHash, currentProject?.path])

  // Load screenshots for visual mode
  useEffect(() => {
    if (!currentProject?.path || !diffBeforeHash) {
      setBeforeScreenshot(null)
      setAfterScreenshot(null)
      return
    }
    window.api.screenshot
      .loadCheckpoint(diffBeforeHash, currentProject.path)
      .then(setBeforeScreenshot)

    if (diffAfterHash) {
      window.api.screenshot
        .loadCheckpoint(diffAfterHash, currentProject.path)
        .then(setAfterScreenshot)
    } else {
      setAfterScreenshot(null)
    }
  }, [diffBeforeHash, diffAfterHash, currentProject?.path])

  const toggleFile = useCallback((index: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  // No checkpoints selected
  if (!diffBeforeHash) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-2">
          <ArrowLeftRight size={24} className="mx-auto text-white/20" />
          <p>Select two checkpoints in Timeline to compare</p>
          <p className="text-[10px] text-white/20">
            Click one checkpoint as &quot;Before&quot;, then another as &quot;After&quot;
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Mode toggle + hash info */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('text')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              mode === 'text' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
            }`}
          >
            Text Diff
          </button>
          <button
            onClick={() => setMode('visual')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              mode === 'visual' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
            }`}
          >
            Visual
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-amber-400">{diffBeforeHash.slice(0, 7)}</span>
          <ArrowLeftRight size={10} className="text-white/30" />
          <span className="text-[var(--accent-cyan)]">
            {diffAfterHash ? diffAfterHash.slice(0, 7) : 'current'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'text' ? (
          <TextDiff
            files={parsedFiles}
            rawDiff={diffText}
            collapsedFiles={collapsedFiles}
            toggleFile={toggleFile}
            beforeHash={diffBeforeHash}
            projectPath={currentProject?.path || null}
          />
        ) : (
          <VisualDiff
            beforeScreenshot={beforeScreenshot}
            afterScreenshot={afterScreenshot}
            previewUrl={previewUrl}
            diffBeforeHash={diffBeforeHash}
            diffAfterHash={diffAfterHash}
          />
        )}
      </div>
    </div>
  )
}

function TextDiff({
  files,
  rawDiff,
  collapsedFiles,
  toggleFile,
  beforeHash,
  projectPath
}: {
  files: DiffFile[]
  rawDiff: string
  collapsedFiles: Set<number>
  toggleFile: (i: number) => void
  beforeHash: string
  projectPath: string | null
}) {
  if (!rawDiff) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        No changes between these commits
      </div>
    )
  }

  if (files.length === 0) {
    // Fallback: raw diff display
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap">{rawDiff}</pre>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      {files.map((file, fi) => (
        <div key={fi} className="border-b border-white/5">
          {/* File header */}
          <div className="flex items-center bg-[var(--bg-tertiary)] hover:bg-white/5 transition">
            <button
              onClick={() => toggleFile(fi)}
              className="flex-1 flex items-center gap-2 px-4 py-2 text-left"
            >
              <span className="text-[10px] text-white/30">{collapsedFiles.has(fi) ? '▶' : '▼'}</span>
              <span className="text-xs font-mono font-semibold text-blue-400">
                {extractFilePath(file.header)}
              </span>
              <span className="text-[10px] text-white/30 ml-auto">
                {file.hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === 'add').length, 0)} added,{' '}
                {file.hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === 'remove').length, 0)} removed
              </span>
            </button>
            {projectPath && (
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  const fp = extractFilePath(file.header)
                  if (!confirm(`Revert ${fp} to the "Before" version?`)) return
                  const result = await window.api.git.revertFile(projectPath, beforeHash, fp)
                  if (result.success) {
                    useToastStore.getState().addToast(`Reverted ${fp}`, 'success')
                  } else {
                    useToastStore.getState().addToast(`Revert failed: ${result.error}`, 'error')
                  }
                }}
                className="px-3 py-1 mr-2 flex items-center gap-1 text-[10px] text-white/30 hover:text-orange-400 transition-colors"
                title="Revert this file"
              >
                <Undo2 size={10} /> Revert
              </button>
            )}
          </div>

          {!collapsedFiles.has(fi) &&
            file.hunks.map((hunk, hi) => (
              <div key={hi}>
                {/* Hunk header */}
                <div className="px-4 py-1 text-[10px] font-mono text-blue-300/60 bg-blue-500/5">
                  {hunk.header}
                </div>
                {/* Lines */}
                <div className="font-mono text-xs">
                  {hunk.lines.map((line, li) => (
                    <div
                      key={li}
                      className={`px-4 py-px whitespace-pre-wrap ${
                        line.type === 'add'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : line.type === 'remove'
                            ? 'bg-red-500/10 text-red-400'
                            : 'text-white/50'
                      }`}
                    >
                      <span className="inline-block w-4 text-white/20 select-none">
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                      </span>
                      {line.content}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

function VisualDiff({
  beforeScreenshot,
  afterScreenshot,
  previewUrl,
  diffBeforeHash,
  diffAfterHash
}: {
  beforeScreenshot: string | null
  afterScreenshot: string | null
  previewUrl: string | null
  diffBeforeHash: string
  diffAfterHash: string | null
}) {
  return (
    <div className="h-full flex">
      {/* Before pane */}
      <div className="flex-1 border-r border-white/10 flex flex-col">
        <div className="px-3 py-1.5 text-[10px] bg-[var(--bg-tertiary)] border-b border-white/10 flex items-center gap-2">
          <span className="bg-amber-400 text-black px-1.5 py-0.5 rounded font-semibold">Before</span>
          <span className="text-white/40">{diffBeforeHash.slice(0, 7)}</span>
        </div>
        <div className="flex-1 overflow-auto bg-[#111]">
          {beforeScreenshot ? (
            <img src={beforeScreenshot} alt="Before" className="w-full object-contain" />
          ) : (
            <div className="h-full flex items-center justify-center text-white/20 text-xs">
              No screenshot for this checkpoint
            </div>
          )}
        </div>
      </div>

      {/* After pane */}
      <div className="flex-1 flex flex-col">
        <div className="px-3 py-1.5 text-[10px] bg-[var(--bg-tertiary)] border-b border-white/10 flex items-center gap-2">
          <span className="bg-[var(--accent-cyan)] text-black px-1.5 py-0.5 rounded font-semibold">After</span>
          <span className="text-white/40">
            {diffAfterHash ? diffAfterHash.slice(0, 7) : 'current'}
          </span>
        </div>
        <div className="flex-1 overflow-auto bg-[#111]">
          {diffAfterHash && afterScreenshot ? (
            <img src={afterScreenshot} alt="After" className="w-full object-contain" />
          ) : diffAfterHash && !afterScreenshot ? (
            <div className="h-full flex items-center justify-center text-white/20 text-xs">
              No screenshot for this checkpoint
            </div>
          ) : previewUrl ? (
            <iframe
              src={previewUrl}
              className="w-full h-full border-0"
              title="After (live)"
              sandbox="allow-same-origin allow-scripts"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-white/20 text-xs">
              No preview URL — start dev server first
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
