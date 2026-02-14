import { useEffect, useRef, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'

export function useFileWatcher(onFileChange: (path: string) => void) {
  const { currentProject } = useProjectStore()
  const cleanupRef = useRef<(() => void) | null>(null)
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

    window.api.fs.watch(projectPath)
    cleanupRef.current = window.api.fs.onChange(handleChange)

    return () => {
      cleanupRef.current?.()
      window.api.fs.unwatch(projectPath)
    }
  }, [projectPath, handleChange])
}
