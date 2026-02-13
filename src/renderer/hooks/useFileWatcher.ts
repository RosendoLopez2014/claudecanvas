import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/project'

export function useFileWatcher(onFileChange: (path: string) => void) {
  const { currentProject } = useProjectStore()
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!currentProject?.path) return

    window.api.fs.watch(currentProject.path)
    cleanupRef.current = window.api.fs.onChange(onFileChange)

    return () => {
      cleanupRef.current?.()
      window.api.fs.unwatch()
    }
  }, [currentProject?.path, onFileChange])
}
