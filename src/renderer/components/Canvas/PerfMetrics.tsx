import { useState, useEffect, useCallback, useRef } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { useActiveTab } from '@/stores/tabs'

interface Metrics {
  lcp: number | null
  fid: number | null
  cls: number | null
  ttfb: number | null
}

type Rating = 'good' | 'needs-improvement' | 'poor'

const THRESHOLDS: Record<string, [number, number]> = {
  lcp: [2500, 4000],
  fid: [100, 300],
  cls: [0.1, 0.25],
  ttfb: [800, 1800],
}

function getRating(metric: string, value: number): Rating {
  const [good, poor] = THRESHOLDS[metric] || [0, 0]
  if (value <= good) return 'good'
  if (value <= poor) return 'needs-improvement'
  return 'poor'
}

const RATING_COLORS: Record<Rating, string> = {
  'good': 'text-green-400',
  'needs-improvement': 'text-yellow-400',
  'poor': 'text-red-400',
}

const RATING_BG: Record<Rating, string> = {
  'good': 'bg-green-500/10',
  'needs-improvement': 'bg-yellow-500/10',
  'poor': 'bg-red-500/10',
}

// Perf observer injection script
const PERF_SCRIPT = `
(function() {
  if (window.__perfMetrics) return;
  window.__perfMetrics = { lcp: null, fid: null, cls: 0, ttfb: null };

  // TTFB
  var navEntries = performance.getEntriesByType('navigation');
  if (navEntries.length > 0) {
    window.__perfMetrics.ttfb = navEntries[0].responseStart;
  }

  // LCP
  try {
    new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      if (entries.length > 0) {
        window.__perfMetrics.lcp = entries[entries.length - 1].startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch(e) {}

  // FID
  try {
    new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      if (entries.length > 0) {
        window.__perfMetrics.fid = entries[0].processingStart - entries[0].startTime;
      }
    }).observe({ type: 'first-input', buffered: true });
  } catch(e) {}

  // CLS
  try {
    new PerformanceObserver(function(list) {
      list.getEntries().forEach(function(entry) {
        if (!entry.hadRecentInput) {
          window.__perfMetrics.cls += entry.value;
        }
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch(e) {}
})();
`

export function PerfMetrics() {
  const [metrics, setMetrics] = useState<Metrics>({ lcp: null, fid: null, cls: null, ttfb: null })
  const [expanded, setExpanded] = useState(false)
  const currentTab = useActiveTab()
  const previewUrl = currentTab?.previewUrl ?? null
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const collectMetrics = useCallback(() => {
    const iframe = document.querySelector('iframe[name="claude-canvas-preview"]') as HTMLIFrameElement
    if (!iframe?.contentWindow) return

    try {
      const win = iframe.contentWindow as any

      // Inject perf script if not yet present
      if (!win.__perfMetrics) {
        const script = iframe.contentDocument?.createElement('script')
        if (script) {
          script.textContent = PERF_SCRIPT
          iframe.contentDocument?.head.appendChild(script)
        }
        return
      }

      setMetrics({
        lcp: win.__perfMetrics.lcp,
        fid: win.__perfMetrics.fid,
        cls: win.__perfMetrics.cls,
        ttfb: win.__perfMetrics.ttfb,
      })
    } catch {
      // Cross-origin or not loaded yet
    }
  }, [])

  useEffect(() => {
    if (!previewUrl) return

    // Start polling after a delay for page load
    const startTimer = setTimeout(() => {
      collectMetrics()
      intervalRef.current = setInterval(collectMetrics, 3000)
    }, 2000)

    return () => {
      clearTimeout(startTimer)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [previewUrl, collectMetrics])

  const hasMetrics = metrics.lcp !== null || metrics.ttfb !== null

  if (!previewUrl) return null

  const metricItems = [
    { key: 'lcp', label: 'LCP', value: metrics.lcp, unit: 'ms', desc: 'Largest Contentful Paint' },
    { key: 'fid', label: 'FID', value: metrics.fid, unit: 'ms', desc: 'First Input Delay' },
    { key: 'cls', label: 'CLS', value: metrics.cls, unit: '', desc: 'Cumulative Layout Shift' },
    { key: 'ttfb', label: 'TTFB', value: metrics.ttfb, unit: 'ms', desc: 'Time to First Byte' },
  ]

  // Overall rating
  const worstRating: Rating = metricItems.reduce<Rating>((worst, m) => {
    if (m.value === null) return worst
    const r = getRating(m.key, m.value)
    if (r === 'poor') return 'poor'
    if (r === 'needs-improvement' && worst !== 'poor') return 'needs-improvement'
    return worst
  }, 'good')

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition ${
          hasMetrics ? RATING_COLORS[worstRating] + ' ' + RATING_BG[worstRating] : 'text-white/30'
        }`}
        title="Performance metrics"
      >
        <Activity size={10} />
        {hasMetrics && metrics.lcp !== null && (
          <span>{Math.round(metrics.lcp)}ms</span>
        )}
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
          <div className="absolute bottom-full right-0 mb-1 z-50 bg-[var(--bg-secondary)] border border-white/10 rounded-lg py-2 px-3 shadow-xl min-w-[200px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">Web Vitals</span>
              <button onClick={collectMetrics} className="p-0.5 hover:bg-white/10 rounded">
                <RefreshCw size={10} className="text-white/30" />
              </button>
            </div>
            {metricItems.map((m) => {
              const value = m.value
              const rating = value !== null ? getRating(m.key, value) : null
              return (
                <div key={m.key} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                  <div>
                    <div className="text-[11px] text-white/60">{m.label}</div>
                    <div className="text-[9px] text-white/25">{m.desc}</div>
                  </div>
                  <span className={`text-[11px] font-mono ${rating ? RATING_COLORS[rating] : 'text-white/20'}`}>
                    {value !== null ? (m.key === 'cls' ? value.toFixed(3) : Math.round(value) + m.unit) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
