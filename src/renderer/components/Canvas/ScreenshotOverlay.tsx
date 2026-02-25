import { useState, useRef, useEffect, useCallback } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'

interface SelectionRect {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export function ScreenshotOverlay() {
  const setScreenshotMode = useCallback((active: boolean) => {
    const tab = useTabsStore.getState().getActiveTab()
    if (tab) useTabsStore.getState().updateTab(tab.id, { screenshotMode: active })
  }, [])
  const overlayRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [capturing, setCapturing] = useState(false)

  const cancel = useCallback(() => {
    setSelection(null)
    setScreenshotMode(false)
  }, [setScreenshotMode])

  // Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cancel])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (capturing) return
    const overlay = overlayRef.current
    if (!overlay) return

    const rect = overlay.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setSelection({ startX: x, startY: y, currentX: x, currentY: y })
  }, [capturing])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!selection || capturing) return
    const overlay = overlayRef.current
    if (!overlay) return

    const rect = overlay.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))

    setSelection((prev) => prev ? { ...prev, currentX: x, currentY: y } : null)
  }, [selection, capturing])

  const handleMouseUp = useCallback(async () => {
    if (!selection || capturing) return

    const w = Math.abs(selection.currentX - selection.startX)
    const h = Math.abs(selection.currentY - selection.startY)

    // Ignore accidental clicks
    if (w < 10 || h < 10) {
      setSelection(null)
      return
    }

    setCapturing(true)

    const overlay = overlayRef.current
    if (!overlay) return

    const overlayRect = overlay.getBoundingClientRect()

    // capturePage expects DIP (CSS pixel) coordinates, NOT physical pixels
    const captureRect = {
      x: Math.round(overlayRect.left + Math.min(selection.startX, selection.currentX)),
      y: Math.round(overlayRect.top + Math.min(selection.startY, selection.currentY)),
      width: Math.round(w),
      height: Math.round(h)
    }

    try {
      await window.api.screenshot.capture(captureRect)

      // Send message to Claude Code — use \r to submit as Enter
      const tab = useTabsStore.getState().getActiveTab()
      if (tab?.ptyId) {
        window.api.pty.write(
          tab.ptyId,
          'View my screenshot with canvas_get_screenshot\r'
        )
      }

      useToastStore.getState().addToast('Screenshot sent to Claude', 'success')
    } catch (err) {
      console.error('Screenshot capture failed:', err)
      useToastStore.getState().addToast('Screenshot capture failed', 'error')
    } finally {
      setSelection(null)
      setCapturing(false)
      setScreenshotMode(false)
    }
  }, [selection, capturing, setScreenshotMode])

  // Compute the visible selection rectangle
  const selRect = selection
    ? {
        left: Math.min(selection.startX, selection.currentX),
        top: Math.min(selection.startY, selection.currentY),
        width: Math.abs(selection.currentX - selection.startX),
        height: Math.abs(selection.currentY - selection.startY)
      }
    : null

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-50"
      style={{ cursor: capturing ? 'wait' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Dimmed background */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Selection rectangle */}
      {selRect && selRect.width > 0 && selRect.height > 0 && (
        <div
          className="absolute border-2 border-dashed border-cyan-400 bg-cyan-400/10"
          style={{
            left: selRect.left,
            top: selRect.top,
            width: selRect.width,
            height: selRect.height
          }}
        />
      )}

      {/* Instructions */}
      {!selection && !capturing && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/80 text-white/70 text-xs px-3 py-1.5 rounded-full">
          Drag to select area &middot; Esc to cancel
        </div>
      )}
    </div>
  )
}
