import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useGalleryStore } from '@/stores/gallery'

/**
 * Build the preview URL for a component rendered via the dev server.
 */
function buildPreviewUrl(devUrl: string, previewFilename: string, relativePath: string): string {
  return `${devUrl}/${previewFilename}?c=${encodeURIComponent(relativePath)}`
}

/**
 * Gallery hook — no auto-scanning. The gallery only shows items Claude adds
 * via the canvas_add_to_gallery MCP tool.
 *
 * This hook handles one thing: when the dev server comes online, upgrade
 * MCP-added variants that have a componentPath with live preview URLs
 * so they render the actual component with HMR.
 */
export function useAutoGallery() {
  const upgradedRef = useRef(false)

  const devStatus = useTabsStore(
    (s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      return tab?.dev?.status ?? 'stopped'
    },
    Object.is
  )
  const devUrl = useTabsStore(
    (s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      return tab?.dev?.url ?? null
    },
    Object.is
  )

  useEffect(() => {
    if (devStatus !== 'running' || !devUrl) {
      upgradedRef.current = false
      return
    }
    if (upgradedRef.current) return

    const activeTab = useTabsStore.getState().getActiveTab()
    if (!activeTab) return
    const projectPath = activeTab.project.path
    if (!projectPath) return

    upgradedRef.current = true

    // Write the preview harness, then upgrade MCP-added variants that have
    // a componentPath but no previewUrl yet (gives them live HMR previews)
    window.api.component.previewSetup(projectPath).then((previewFilename) => {
      if (!previewFilename) return

      const gallery = useGalleryStore.getState()
      const upgradeable = gallery.variants.filter(
        (v) => v.componentPath && !v.previewUrl
      )
      if (upgradeable.length === 0) return

      for (const v of upgradeable) {
        gallery.updateVariant(v.id, {
          previewUrl: buildPreviewUrl(devUrl, previewFilename, v.componentPath!),
          previewStatus: undefined,
          previewError: undefined,
        })
      }
    }).catch((err) => {
      console.warn('[auto-gallery] Failed to upgrade previews:', err)
    })
  }, [devStatus, devUrl])
}
