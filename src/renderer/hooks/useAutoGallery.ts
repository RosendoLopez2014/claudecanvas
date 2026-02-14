import { useEffect } from 'react'
import { useProjectStore } from '@/stores/project'
import { useGalleryStore } from '@/stores/gallery'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'

/** File extensions that can contain React components */
const COMPONENT_EXTS = /\.(tsx|jsx)$/

/** Paths that indicate a components directory */
const COMPONENT_DIR = /[/\\](components?|ui|widgets|views)[/\\]/i

/**
 * Listens for new component files via the file watcher and
 * auto-adds them to the gallery with a placeholder render.
 *
 * This enables the "auto-render on component creation" workflow:
 * Claude creates a component → it appears in the gallery immediately.
 */
export function useAutoGallery() {
  const projectPath = useProjectStore((s) => s.currentProject?.path)

  // Scan existing components on project open
  useEffect(() => {
    if (!projectPath) return

    window.api.component.scan(projectPath).then((components) => {
      const gallery = useGalleryStore.getState()
      const existing = gallery.variants.map((v) => v.label)

      for (const comp of components) {
        if (existing.includes(comp.name)) continue
        gallery.addVariant({
          id: `scan-${Date.now()}-${comp.name}`,
          label: comp.name,
          html: `<div style="padding:20px;font-family:system-ui"><h3>${comp.name}</h3><p style="color:#888;font-size:12px">${comp.relativePath}</p></div>`,
        })
      }
    }).catch(() => {})
  }, [projectPath])

  // Listen for new component file adds
  useEffect(() => {
    if (!projectPath) return

    const cleanup = window.api.fs.onAdd(async ({ projectPath: eventPath, path: filePath }) => {
      if (eventPath !== projectPath) return
      if (!COMPONENT_EXTS.test(filePath)) return
      if (!COMPONENT_DIR.test(filePath)) return

      const parsed = await window.api.component.parse(filePath)
      if (!parsed) return

      // Check if already in gallery (avoid duplicates on rapid saves)
      const existing = useGalleryStore.getState().variants
      if (existing.some((v) => v.label === parsed.name)) return

      useGalleryStore.getState().addVariant({
        id: `auto-${Date.now()}-${parsed.name}`,
        label: parsed.name,
        html: parsed.renderHtml,
      })

      // Open canvas to gallery if not already showing
      if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
        useWorkspaceStore.getState().openCanvas()
      }
      useCanvasStore.getState().setActiveTab('gallery')

      const activeTab = useTabsStore.getState().getActiveTab()
      if (activeTab) {
        useTabsStore.getState().updateTab(activeTab.id, { activeCanvasTab: 'gallery' })
      }

      useToastStore.getState().addToast(`Added ${parsed.name} to gallery`, 'info')
    })

    return cleanup
  }, [projectPath])
}
