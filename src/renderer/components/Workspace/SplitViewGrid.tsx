import { motion } from 'framer-motion'
import { GitBranch } from 'lucide-react'

const PANE_COLORS = ['#4AEAFF', '#FF6B4A', '#4ADE80', '#FACC15']

const DEV_DOT: Record<string, string> = {
  running: 'bg-emerald-400',
  starting: 'bg-amber-400 animate-pulse',
  error: 'bg-red-400',
}

export interface SplitViewTab {
  id: string
  projectName: string
  branch: string | null
  devStatus: string
}

interface SplitPaneHeaderProps {
  tab: SplitViewTab
  index: number
  onSelect: () => void
}

export function SplitPaneHeader({ tab, index, onSelect }: SplitPaneHeaderProps) {
  const color = PANE_COLORS[index % PANE_COLORS.length]
  const dotClass = DEV_DOT[tab.devStatus]

  return (
    <motion.button
      onClick={onSelect}
      className="flex items-center gap-1.5 h-7 px-2 shrink-0 bg-[var(--bg-secondary)] hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5 w-full"
      title="Click to focus this tab"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: 0.05 * index }}
    >
      <div className="w-[3px] h-3.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-white/70 truncate">{tab.projectName}</span>
      {tab.branch && (
        <>
          <GitBranch size={8} className="text-white/20 shrink-0" />
          <span className="text-[9px] text-white/30 truncate">{tab.branch}</span>
        </>
      )}
      {dotClass && <span className={`w-1.5 h-1.5 rounded-full ${dotClass} shrink-0 ml-auto`} />}
    </motion.button>
  )
}

/** Returns CSS Grid styles for the terminal container based on tab count */
export function getGridStyle(count: number): React.CSSProperties {
  if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
  if (count <= 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: count <= 2 ? '1fr' : '1fr 1fr' }
  const rows = Math.ceil(count / 2)
  return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: `repeat(${rows}, 1fr)` }
}

/** For 3 tabs, the last pane spans both columns */
export function shouldSpanFull(tabCount: number, index: number): boolean {
  return tabCount === 3 && index === 2
}
