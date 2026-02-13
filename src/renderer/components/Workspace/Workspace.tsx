import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { TerminalView } from '../Terminal/TerminalView'
import { CanvasPanel } from '../Canvas/CanvasPanel'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { AnimatePresence, motion } from 'framer-motion'

export function Workspace() {
  const { mode } = useWorkspaceStore()
  const { currentProject } = useProjectStore()

  if (mode === 'terminal-only' || mode === 'terminal-inline') {
    return (
      <div className="h-full">
        <TerminalView cwd={currentProject?.path} />
      </div>
    )
  }

  // terminal-canvas mode
  return (
    <Allotment defaultSizes={[50, 50]}>
      <Allotment.Pane minSize={300}>
        <TerminalView cwd={currentProject?.path} />
      </Allotment.Pane>
      <Allotment.Pane minSize={300}>
        <AnimatePresence>
          <motion.div
            className="h-full"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
          >
            <CanvasPanel />
          </motion.div>
        </AnimatePresence>
      </Allotment.Pane>
    </Allotment>
  )
}
