import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useGalleryStore } from '@/stores/gallery'

/**
 * Generate a simple HTML placeholder card for a discovered component.
 */
function componentPlaceholderHtml(name: string, relativePath: string): string {
  return [
    '<div style="padding:16px;font-family:system-ui,sans-serif;',
    'background:#1a1a2e;color:#e0e0e0;border-radius:8px;',
    'border:1px solid rgba(74,234,255,0.15)">',
    `<h3 style="margin:0 0 4px;color:#4AEAFF">${name}</h3>`,
    `<p style="margin:0;color:#888;font-size:13px">Component from ${relativePath}</p>`,
    '</div>',
  ].join('')
}

/**
 * Auto-scan components when the active project changes.
 * Discovers .tsx/.jsx files in src/components/ and adds them to the gallery
 * with source='auto-scan' so they can be distinguished from manual variants.
 */
export function useAutoGallery() {
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const scannedProjectsRef = useRef(new Set<string>())

  useEffect(() => {
    const activeTab = useTabsStore.getState().getActiveTab()
    if (!activeTab) return

    const projectPath = activeTab.project.path
    if (!projectPath) return

    // Only scan each project once per session
    if (scannedProjectsRef.current.has(projectPath)) return
    scannedProjectsRef.current.add(projectPath)

    // Scan in the background — don't block rendering
    window.api.component.scan(projectPath).then((components) => {
      if (!components || components.length === 0) return

      const gallery = useGalleryStore.getState()

      // Check existing variants to avoid duplicates
      const existingLabels = new Set(gallery.variants.map((v) => v.label))

      for (const comp of components) {
        // Skip if a variant with this label already exists
        if (existingLabels.has(comp.name)) continue

        gallery.addVariant({
          id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: comp.name,
          html: componentPlaceholderHtml(comp.name, comp.relativePath),
          description: `Auto-discovered from ${comp.relativePath}`,
          category: 'auto-scan',
          status: 'proposal',
          createdAt: Date.now(),
        })
      }
    }).catch((err) => {
      console.warn('[auto-gallery] Failed to scan components:', err)
    })
  }, [activeTabId])
}
