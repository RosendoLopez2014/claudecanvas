import { useEffect, useRef, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
import { useGalleryStore } from '@/stores/gallery'
import { useToastStore } from '@/stores/toast'

/**
 * Watchers that have been started. Never torn down on tab switch — only
 * on tab close (via cleanupTabResources). Watcher lifecycle: one per
 * project path, persists for the tab's lifetime, closed on tab close.
 */
const activeWatchers = new Set<string>()

/**
 * Convert a filename to PascalCase component name.
 * e.g. "my-button.tsx" -> "MyButton"
 */
function fileNameToComponentName(fileName: string): string {
  const base = fileName.replace(/\.(tsx|jsx)$/, '')
  return base
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

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

export function useFileWatcher(onFileChange: (path: string) => void) {
  const { currentProject } = useProjectStore()
  const cleanupRef = useRef<(() => void) | null>(null)
  const addCleanupRef = useRef<(() => void) | null>(null)
  const projectPath = currentProject?.path

  const handleChange = useCallback(
    (data: { projectPath: string; path: string }) => {
      if (data.projectPath === projectPath) {
        onFileChange(data.path)
      }
    },
    [projectPath, onFileChange]
  )

  useEffect(() => {
    if (!projectPath) return

    // Start watcher if not already running — but NEVER tear it down on
    // tab switch. The watcher stays alive for the lifetime of the tab.
    if (!activeWatchers.has(projectPath)) {
      window.api.fs.watch(projectPath)
      activeWatchers.add(projectPath)
    }

    cleanupRef.current = window.api.fs.onChange(handleChange)

    // Listen for new files to auto-add components to gallery
    addCleanupRef.current = window.api.fs.onAdd(
      (data: { projectPath: string; path: string }) => {
        if (data.projectPath !== projectPath) return

        // Only handle .tsx/.jsx files inside src/components/
        const relativePath = data.path.replace(projectPath + '/', '')
        if (!relativePath.startsWith('src/components/')) return
        if (!/\.(tsx|jsx)$/.test(data.path)) return

        // Skip test/spec/stories/index files
        const fileName = data.path.split('/').pop() || ''
        if (
          fileName.includes('.test.') ||
          fileName.includes('.spec.') ||
          fileName.includes('.stories.') ||
          fileName === 'index.tsx' ||
          fileName === 'index.jsx'
        ) {
          return
        }

        const componentName = fileNameToComponentName(fileName)

        // Check for duplicates in the gallery
        const { variants } = useGalleryStore.getState()
        if (variants.some((v) => v.label === componentName)) return

        useGalleryStore.getState().addVariant({
          id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: componentName,
          html: componentPlaceholderHtml(componentName, relativePath),
          description: `Auto-discovered from ${relativePath}`,
          category: 'auto-scan',
          status: 'proposal',
          createdAt: Date.now(),
        })

        useToastStore
          .getState()
          .addToast(`Added ${componentName} to gallery`, 'success')
      }
    )

    return () => {
      // Only remove the IPC listeners — do NOT call fs.unwatch().
      // The watcher keeps running for this project path.
      cleanupRef.current?.()
      addCleanupRef.current?.()
    }
  }, [projectPath, handleChange])
}
