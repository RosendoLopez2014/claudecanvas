import { useState, useCallback } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import { useToastStore } from '@/stores/toast'

interface FeedbackItem {
  category: string
  suggestion: string
  severity: 'info' | 'warning' | 'improvement'
}

export function DesignFeedback() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackItem[]>([])
  const previewUrl = useCanvasStore((s) => s.previewUrl)

  const requestFeedback = useCallback(async () => {
    if (!previewUrl) {
      useToastStore.getState().addToast('Start a dev server first', 'info')
      return
    }

    setLoading(true)
    setOpen(true)
    setFeedback([])

    try {
      // Capture screenshot of the preview iframe
      const iframe = document.querySelector('iframe[name="claude-canvas-preview"]') as HTMLIFrameElement
      if (!iframe) {
        setLoading(false)
        return
      }

      const rect = iframe.getBoundingClientRect()
      const screenshot = await window.api.screenshot.capture({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })

      if (!screenshot) {
        useToastStore.getState().addToast('Failed to capture screenshot', 'error')
        setLoading(false)
        return
      }

      // Generate feedback based on page structure analysis
      // (In a full implementation, this would send to Claude API via MCP)
      // For now, analyze the DOM structure for common issues
      const doc = iframe.contentDocument
      if (!doc) {
        setLoading(false)
        return
      }

      const items: FeedbackItem[] = []

      // Check for missing alt text on images
      const images = doc.querySelectorAll('img')
      let missingAlt = 0
      images.forEach((img) => {
        if (!img.getAttribute('alt')) missingAlt++
      })
      if (missingAlt > 0) {
        items.push({
          category: 'Accessibility',
          suggestion: `${missingAlt} image${missingAlt > 1 ? 's' : ''} missing alt text. Add descriptive alt attributes for screen readers.`,
          severity: 'warning'
        })
      }

      // Check for color contrast (simplified check)
      const buttons = doc.querySelectorAll('button')
      if (buttons.length === 0) {
        items.push({
          category: 'UX',
          suggestion: 'No interactive buttons found. Consider adding clear call-to-action elements.',
          severity: 'improvement'
        })
      }

      // Check heading hierarchy
      const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')
      const levels = Array.from(headings).map((h) => parseInt(h.tagName[1]))
      if (levels.length > 0 && levels[0] !== 1) {
        items.push({
          category: 'SEO',
          suggestion: 'Page should start with an H1 heading. Found H' + levels[0] + ' first.',
          severity: 'warning'
        })
      }

      // Check for viewport meta tag
      const viewportMeta = doc.querySelector('meta[name="viewport"]')
      if (!viewportMeta) {
        items.push({
          category: 'Responsive',
          suggestion: 'Missing viewport meta tag. Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile responsiveness.',
          severity: 'warning'
        })
      }

      // Check for text readability (very small text)
      const smallTextEls = doc.querySelectorAll('p, span, div, a, li')
      let tinyText = 0
      smallTextEls.forEach((el) => {
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 12) tinyText++
      })
      if (tinyText > 5) {
        items.push({
          category: 'Typography',
          suggestion: `${tinyText} elements have font size below 12px. Consider increasing for better readability.`,
          severity: 'improvement'
        })
      }

      // Check for semantic HTML
      const hasNav = !!doc.querySelector('nav')
      const hasMain = !!doc.querySelector('main')
      const hasFooter = !!doc.querySelector('footer')
      if (!hasNav && !hasMain && !hasFooter) {
        items.push({
          category: 'Semantics',
          suggestion: 'No semantic HTML landmarks found (nav, main, footer). Using semantic elements improves accessibility and SEO.',
          severity: 'info'
        })
      }

      // Check for excessive nesting
      const deepElements = doc.querySelectorAll('body *')
      let maxDepth = 0
      deepElements.forEach((el) => {
        let depth = 0
        let current: Element | null = el
        while (current && current !== doc.body) {
          depth++
          current = current.parentElement
        }
        if (depth > maxDepth) maxDepth = depth
      })
      if (maxDepth > 15) {
        items.push({
          category: 'Performance',
          suggestion: `DOM nesting depth of ${maxDepth} detected. Deep nesting can slow rendering. Consider flattening the structure.`,
          severity: 'improvement'
        })
      }

      if (items.length === 0) {
        items.push({
          category: 'Overall',
          suggestion: 'No major design issues detected. The page structure looks good!',
          severity: 'info'
        })
      }

      setFeedback(items)
    } catch (err) {
      useToastStore.getState().addToast('Feedback analysis failed', 'error')
    }
    setLoading(false)
  }, [previewUrl])

  const severityColors = {
    info: 'text-blue-400 bg-blue-500/10',
    warning: 'text-orange-400 bg-orange-500/10',
    improvement: 'text-purple-400 bg-purple-500/10',
  }

  return (
    <>
      <button
        onClick={requestFeedback}
        disabled={loading}
        className="p-1 hover:bg-white/10 rounded transition-colors"
        title="Get design feedback"
      >
        {loading ? (
          <Loader2 size={12} className="text-purple-400 animate-spin" />
        ) : (
          <Sparkles size={12} className="text-white/40" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed top-[15%] right-[5%] w-[320px] max-h-[60%] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles size={12} className="text-purple-400" />
                <span className="text-xs text-white/70 font-medium">Design Feedback</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-0.5 hover:bg-white/10 rounded">
                <X size={12} className="text-white/40" />
              </button>
            </div>

            <div className="flex-1 overflow-auto py-1">
              {loading && (
                <div className="px-3 py-6 text-center text-xs text-white/30">Analyzing design...</div>
              )}
              {feedback.map((item, i) => (
                <div key={i} className="px-3 py-2 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${severityColors[item.severity]}`}>
                      {item.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/50 leading-relaxed">{item.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}
