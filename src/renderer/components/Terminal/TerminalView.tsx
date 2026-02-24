import { useEffect, useRef, useState, useCallback } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { usePty } from '@/hooks/usePty'
import { useTerminalStore } from '@/stores/terminal'
import { useTabsStore } from '@/stores/tabs'
import {
  getOrCreateTerminal,
  setTerminalContainer,
  setSearchAddon,
  getSearchAddon,
  destroyTerminal
} from '@/services/terminalPool'
import { X, Plus, ChevronDown, Terminal as TerminalIcon } from 'lucide-react'

const TERMINAL_OPTIONS = {
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: 13,
  lineHeight: 1.4,
  letterSpacing: 0,
  theme: {
    background: '#0A0F1A',
    foreground: '#C8D6E5',
    cursor: '#4AEAFF',
    cursorAccent: '#0A0F1A',
    selectionBackground: 'rgba(74, 234, 255, 0.2)',
    selectionForeground: '#FFFFFF',
    black: '#1a1e2e',
    red: '#FF6B4A',
    green: '#4ADE80',
    yellow: '#FACC15',
    blue: '#60A5FA',
    magenta: '#C084FC',
    cyan: '#4AEAFF',
    white: '#C8D6E5',
    brightBlack: '#4B5563',
    brightRed: '#FF8A6A',
    brightGreen: '#6EE7A0',
    brightYellow: '#FDE047',
    brightBlue: '#93C5FD',
    brightMagenta: '#D8B4FE',
    brightCyan: '#7EEDFF',
    brightWhite: '#F9FAFB'
  },
  allowProposedApi: true,
  scrollback: 10000,
  cursorBlink: true,
  cursorStyle: 'bar' as const
}

interface TerminalViewProps {
  cwd?: string
  tabId?: string
  autoLaunchClaude?: boolean
  isTabActive?: boolean
}

/** A single terminal pane within a split layout */
function SplitPane({
  poolKey,
  tabId,
  cwd,
  autoLaunchClaude,
  onClose,
  showClose,
  visible
}: {
  poolKey: string
  tabId: string
  cwd?: string
  autoLaunchClaude: boolean
  onClose?: () => void
  showClose: boolean
  visible: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)
  const webglRef = useRef<WebglAddon | null>(null)
  const { connect, resize } = usePty()

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    initializedRef.current = true

    const container = containerRef.current
    const terminal = getOrCreateTerminal(poolKey, TERMINAL_OPTIONS)
    setTerminalContainer(poolKey, container)

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new Unicode11Addon())
    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)
    setSearchAddon(poolKey, searchAddon)

    terminal.open(container)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        webglRef.current = null
      })
      terminal.loadAddon(webgl)
      webglRef.current = webgl
    } catch {
      console.warn('WebGL addon failed to load, using canvas renderer')
    }

    fitAddon.fit()
    connect(terminal, cwd, { autoLaunchClaude, tabId })
    useTerminalStore.getState().setFocusFn(() => terminal.focus())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track terminal dimensions to avoid redundant fit()/resize() calls
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null)

  const doFit = useCallback(() => {
    if (!fitAddonRef.current) return
    const t0 = performance.now()
    const terminal = getOrCreateTerminal(poolKey, TERMINAL_OPTIONS)
    const prevCols = terminal.cols
    const prevRows = terminal.rows
    fitAddonRef.current.fit()
    const newCols = terminal.cols
    const newRows = terminal.rows
    // Only send IPC resize if dimensions actually changed
    if (newCols !== prevCols || newRows !== prevRows) {
      resize(newCols, newRows)
      lastDimsRef.current = { cols: newCols, rows: newRows }
      console.log(`[TAB-DEBUG] fit: ${prevCols}x${prevRows} → ${newCols}x${newRows} (${(performance.now() - t0).toFixed(1)}ms)`)
    }
  }, [poolKey, resize])

  // Observe container resize — only when visible, heavily debounced
  useEffect(() => {
    if (!visible || !containerRef.current) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(doFit, 150)
    })

    // Defer initial fit slightly to let the layout settle after tab switch
    const fitTimer = setTimeout(doFit, 100)

    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
      clearTimeout(fitTimer)
    }
  }, [visible, doFit])

  // WebGL stays alive on hidden terminals — disposing/recreating GPU contexts on
  // every tab switch is expensive and causes multi-second freezes after rapid switching.
  // CSS visibility:hidden already prevents rendering; idle WebGL is nearly zero cost.

  return (
    <div className="w-full h-full relative group/split">
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ padding: '8px 0 0 8px' }}
      />
      {showClose && (
        <button
          onClick={onClose}
          className="absolute top-1 right-1 p-0.5 rounded opacity-0 group-hover/split:opacity-100 hover:bg-white/10 transition-opacity z-10"
          title="Close split"
        >
          <X size={12} className="text-white/40" />
        </button>
      )}
    </div>
  )
}

/** Terminal content for a single instance (may contain splits) */
function TerminalContent({
  tabId,
  instanceId,
  cwd,
  autoLaunchClaude,
  visible
}: {
  tabId: string
  instanceId: string
  cwd?: string
  autoLaunchClaude: boolean
  visible: boolean
}) {
  const splits = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    return tab?.splits ?? ['main']
  })

  const mainKey = `${tabId}:${instanceId}`
  const allPanes = splits.map((splitId, idx) => ({
    key: idx === 0 ? mainKey : `${tabId}:${instanceId}:${splitId}`,
    splitId,
    isMain: idx === 0
  }))

  const handleCloseSplit = useCallback((splitId: string) => {
    const poolKey = `${tabId}:${instanceId}:${splitId}`
    destroyTerminal(poolKey)
    useTabsStore.getState().removeSplit(tabId, splitId)
  }, [tabId, instanceId])

  return (
    <div className="absolute inset-0" style={{ visibility: visible ? 'visible' : 'hidden' }}>
      {allPanes.length === 1 ? (
        <SplitPane
          key={allPanes[0].key}
          poolKey={allPanes[0].key}
          tabId={tabId}
          cwd={cwd}
          autoLaunchClaude={autoLaunchClaude}
          showClose={false}
          visible={visible}
        />
      ) : (
        <Allotment>
          {allPanes.map((pane) => (
            <Allotment.Pane key={pane.key}>
              <SplitPane
                poolKey={pane.key}
                tabId={tabId}
                cwd={cwd}
                autoLaunchClaude={pane.isMain ? autoLaunchClaude : false}
                onClose={pane.isMain ? undefined : () => handleCloseSplit(pane.splitId)}
                showClose={!pane.isMain}
                visible={visible}
              />
            </Allotment.Pane>
          ))}
        </Allotment>
      )}
    </div>
  )
}

export function TerminalView({ cwd, tabId, autoLaunchClaude = true, isTabActive = true }: TerminalViewProps) {
  const instancesRaw = useTerminalStore((s) => tabId ? s.instances[tabId] : undefined)
  const instances = instancesRaw || []
  const activeInstanceId = useTerminalStore((s) => tabId ? (s.activeInstance[tabId] || '') : '')

  const [selectorOpen, setSelectorOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Ensure at least one terminal instance exists for this tab
  useEffect(() => {
    if (!tabId) return
    useTerminalStore.getState().ensureDefaultInstance(tabId)
  }, [tabId])

  const handleAddTerminal = useCallback(() => {
    if (!tabId) return
    useTerminalStore.getState().addInstance(tabId)
    setSelectorOpen(false)
  }, [tabId])

  const handleRemoveTerminal = useCallback((instanceId: string) => {
    if (!tabId) return
    destroyTerminal(`${tabId}:${instanceId}`)
    useTerminalStore.getState().removeInstance(tabId, instanceId)
    setSelectorOpen(false)
  }, [tabId])

  const handleSelectTerminal = useCallback((instanceId: string) => {
    if (!tabId) return
    useTerminalStore.getState().setActiveInstance(tabId, instanceId)
    setSelectorOpen(false)
  }, [tabId])

  // Ctrl+F search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const currentPoolKey = tabId && activeInstanceId ? `${tabId}:${activeInstanceId}` : null

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (!currentPoolKey) return
    const addon = getSearchAddon(currentPoolKey)
    if (!addon) return
    if (value) {
      addon.findNext(value, { incremental: true })
    } else {
      addon.clearDecorations()
    }
  }, [currentPoolKey])

  const findNext = useCallback(() => {
    if (!currentPoolKey || !searchQuery) return
    getSearchAddon(currentPoolKey)?.findNext(searchQuery)
  }, [currentPoolKey, searchQuery])

  const findPrevious = useCallback(() => {
    if (!currentPoolKey || !searchQuery) return
    getSearchAddon(currentPoolKey)?.findPrevious(searchQuery)
  }, [currentPoolKey, searchQuery])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    if (currentPoolKey) getSearchAddon(currentPoolKey)?.clearDecorations()
  }, [currentPoolKey])

  const showToolbar = instances.length > 1
  const activeLabel = instances.find((i) => i.id === activeInstanceId)?.label || 'Terminal 1'

  return (
    <div className="w-full h-full flex flex-col relative">
      {/* Terminal toolbar — only visible with multiple terminals */}
      {showToolbar && (
        <div className="h-7 flex-shrink-0 flex items-center justify-between px-2 bg-[#0A0F1A] border-b border-white/5">
          <div className="relative">
            <button
              onClick={() => setSelectorOpen((v) => !v)}
              className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-white/50 hover:text-white/80 hover:bg-white/5 rounded transition-colors"
            >
              <TerminalIcon size={11} />
              <span>{activeLabel}</span>
              <ChevronDown size={10} />
            </button>

            {selectorOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSelectorOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--bg-secondary)] border border-white/10 rounded-lg py-1 shadow-xl min-w-[160px]">
                  {instances.map((inst) => (
                    <div key={inst.id} className="flex items-center group">
                      <button
                        onClick={() => handleSelectTerminal(inst.id)}
                        className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${
                          inst.id === activeInstanceId ? 'text-[var(--accent-cyan)]' : 'text-white/60'
                        }`}
                      >
                        {inst.label}
                      </button>
                      {instances.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveTerminal(inst.id)
                          }}
                          className="px-2 py-1 opacity-0 group-hover:opacity-100 hover:text-red-400 text-white/30 transition-opacity"
                          title="Close terminal"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-white/5 mt-1 pt-1">
                    <button
                      onClick={handleAddTerminal}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
                    >
                      <Plus size={10} />
                      New Terminal
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleAddTerminal}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="New terminal"
          >
            <Plus size={12} className="text-white/40" />
          </button>
        </div>
      )}

      {/* Terminal content area — relative so absolute-positioned instances stack */}
      <div className="flex-1 min-h-0 relative">
        {instances.map((inst, idx) => (
          <TerminalContent
            key={inst.id}
            tabId={tabId || 'default'}
            instanceId={inst.id}
            cwd={cwd}
            autoLaunchClaude={idx === 0 ? autoLaunchClaude : false}
            visible={isTabActive && inst.id === activeInstanceId}
          />
        ))}
      </div>

      {/* Terminal search bar */}
      {searchOpen && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-2 py-1.5 shadow-lg z-10">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? findPrevious() : findNext()
              } else if (e.key === 'Escape') {
                closeSearch()
              }
            }}
            placeholder="Find in terminal..."
            className="w-40 bg-transparent text-xs text-white placeholder-white/30 outline-none"
          />
          <button onClick={findPrevious} className="p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white/60 text-[10px]" title="Previous (Shift+Enter)">
            ↑
          </button>
          <button onClick={findNext} className="p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white/60 text-[10px]" title="Next (Enter)">
            ↓
          </button>
          <button onClick={closeSearch} className="p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white/60 text-[10px]" title="Close (Esc)">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
