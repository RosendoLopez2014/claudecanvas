import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTabsStore } from '@/stores/tabs'

/** Default number of file changes before auto-checkpoint */
const AUTO_CHECKPOINT_THRESHOLD = 5

/**
 * Tracks file change count and auto-creates a git checkpoint
 * after a configurable number of changes (default: 5).
 *
 * Uses a debounce to batch rapid saves (e.g., HMR triggering
 * multiple file writes) into a single checkpoint.
 */
export function useAutoCheckpoint() {
  const projectPath = useProjectStore((s) => s.currentProject?.path)
  const changeCountRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!projectPath) return

    const cleanup = window.api.fs.onChange(async ({ projectPath: eventPath }) => {
      if (eventPath !== projectPath) return

      changeCountRef.current++

      // Debounce: wait 3s after last change before deciding to checkpoint
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        const count = changeCountRef.current
        if (count < AUTO_CHECKPOINT_THRESHOLD) return

        // Check if auto-checkpoint is disabled in settings
        const enabled = await window.api.settings.get('autoCheckpointEnabled')
        if (enabled === false) return

        changeCountRef.current = 0
        const message = `Auto: ${count} file changes`

        const result = await window.api.git.checkpoint(projectPath, message)
        if (result?.hash) {
          await window.api.screenshot.captureCheckpoint(result.hash, projectPath)

          // Auto-open diff
          useCanvasStore.getState().setDiffHashes(result.hash + '~1', result.hash)
          const activeTab = useTabsStore.getState().getActiveTab()
          if (activeTab) {
            useTabsStore.getState().updateTab(activeTab.id, {
              diffBeforeHash: result.hash + '~1',
              diffAfterHash: result.hash,
              activeCanvasTab: 'diff',
            })
          }
          useCanvasStore.getState().setActiveTab('diff')
          if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
            useWorkspaceStore.getState().openCanvas()
          }

          useToastStore.getState().addToast(`Auto-checkpoint: ${count} changes`, 'info')
        }
      }, 3000)
    })

    return () => {
      cleanup()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [projectPath])
}
