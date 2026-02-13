import { useEffect, useCallback } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'

interface ShortcutHandlers {
  onQuickActions: () => void
}

export function useKeyboardShortcuts({ onQuickActions }: ShortcutHandlers) {
  const { inspectorActive, setInspectorActive, setActiveTab } = useCanvasStore()
  const { mode, openCanvas, closeCanvas } = useWorkspaceStore()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+K — Quick actions
      if (meta && e.key === 'k') {
        e.preventDefault()
        onQuickActions()
        return
      }

      // Cmd+I — Toggle inspector
      if (meta && e.key === 'i' && !e.shiftKey) {
        e.preventDefault()
        setInspectorActive(!inspectorActive)
        return
      }

      // Cmd+G — Gallery tab
      if (meta && e.key === 'g') {
        e.preventDefault()
        if (mode !== 'terminal-canvas') openCanvas()
        setActiveTab('gallery')
        return
      }

      // Cmd+\ — Toggle canvas
      if (meta && e.key === '\\') {
        e.preventDefault()
        mode === 'terminal-canvas' ? closeCanvas() : openCanvas()
        return
      }

      // Escape — Close overlays / deactivate inspector
      if (e.key === 'Escape') {
        if (inspectorActive) {
          setInspectorActive(false)
        }
        return
      }
    },
    [
      inspectorActive,
      setInspectorActive,
      mode,
      openCanvas,
      closeCanvas,
      setActiveTab,
      onQuickActions
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
