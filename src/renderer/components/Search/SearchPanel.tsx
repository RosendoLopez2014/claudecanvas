import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, FileText, CaseSensitive } from 'lucide-react'
import { useProjectStore } from '@/stores/project'

interface SearchResult {
  filePath: string
  relativePath: string
  lineNumber: number
  lineContent: string
}

interface SearchPanelProps {
  open: boolean
  onClose: () => void
}

export function SearchPanel({ open, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const projectPath = useProjectStore((s) => s.currentProject?.path)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const doSearch = useCallback(async (q: string, cs: boolean) => {
    if (!projectPath || q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const res = await window.api.search.project(projectPath, q, cs)
      setResults(res)
      setSelectedIndex(0)
    } catch {
      setResults([])
    }
    setSearching(false)
  }, [projectPath])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value, caseSensitive), 300)
  }, [doSearch, caseSensitive])

  const toggleCaseSensitive = useCallback(() => {
    const next = !caseSensitive
    setCaseSensitive(next)
    if (query.length >= 2) doSearch(query, next)
  }, [caseSensitive, query, doSearch])

  const handleResultClick = useCallback((result: SearchResult) => {
    navigator.clipboard.writeText(`${result.relativePath}:${result.lineNumber}`)
    onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleResultClick(results[selectedIndex])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [results, selectedIndex, onClose, handleResultClick])

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.relativePath]) acc[r.relativePath] = []
    acc[r.relativePath].push(r)
    return acc
  }, {})

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[10%] left-1/2 -translate-x-1/2 w-[600px] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
              <Search size={14} className="text-white/30" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search in project..."
                className="flex-1 bg-transparent text-sm text-white placeholder-white/30 focus:outline-none"
              />
              <button
                onClick={toggleCaseSensitive}
                className={`p-1 rounded transition ${caseSensitive ? 'bg-white/10 text-[var(--accent-cyan)]' : 'text-white/30 hover:text-white/50'}`}
                title="Case sensitive"
              >
                <CaseSensitive size={14} />
              </button>
              <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition">
                <X size={14} className="text-white/40" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[450px] overflow-auto">
              {searching && results.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-white/30">Searching...</div>
              )}
              {!searching && query.length >= 2 && results.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-white/30">No results found</div>
              )}
              {query.length < 2 && results.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-white/30">Type at least 2 characters to search</div>
              )}
              {Object.entries(grouped).map(([filePath, fileResults]) => (
                <div key={filePath} className="border-b border-white/5 last:border-b-0">
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-white/[0.02]">
                    <FileText size={11} className="text-white/30" />
                    <span className="text-[11px] text-white/50 font-mono truncate">{filePath}</span>
                    <span className="text-[10px] text-white/20 ml-auto">{fileResults.length}</span>
                  </div>
                  {fileResults.map((result) => {
                    const globalIdx = results.indexOf(result)
                    return (
                      <button
                        key={`${result.filePath}:${result.lineNumber}`}
                        onClick={() => handleResultClick(result)}
                        className={`w-full flex items-center gap-3 px-6 py-1 text-left transition-colors ${
                          globalIdx === selectedIndex ? 'bg-white/5' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <span className="text-[10px] text-white/20 w-8 text-right font-mono flex-shrink-0">
                          {result.lineNumber}
                        </span>
                        <span className="text-[11px] text-white/60 font-mono truncate">
                          {highlightMatch(result.lineContent, query, caseSensitive)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {results.length >= 200 && (
                <div className="px-4 py-2 text-center text-[10px] text-white/20">
                  Showing first 200 results. Refine your search for more specific results.
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function highlightMatch(text: string, query: string, caseSensitive: boolean): React.ReactNode {
  if (!query) return text
  const idx = caseSensitive ? text.indexOf(query) : text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[var(--accent-cyan)] font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}
