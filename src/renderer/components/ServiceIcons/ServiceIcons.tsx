import { useEffect, useLayoutEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Github, Triangle, Database, Circle, Loader2, Copy, Check, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, X, Plus, GitBranch, GitPullRequest, ExternalLink, ChevronDown, ChevronRight, Rocket, FileText, Globe, RefreshCw, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useTabsStore, useActiveTab } from '@/stores/tabs'

interface ServiceStatus {
  github: boolean
  vercel: boolean
  supabase: boolean
}

interface GitHubUser {
  login: string
  avatar_url: string
}

interface VercelUser {
  username: string
  name: string | null
  avatar: string | null
}

interface VercelProject {
  id: string
  name: string
  framework: string | null
  url: string | null
}

interface LinkedProjectData {
  linked: true
  project: { id: string; name: string; framework: string | null; productionUrl: string }
  latestDeployment: {
    id: string
    url: string
    state: string
    created: number
    commitMessage: string | null
  } | null
}

interface SupabaseUser {
  name: string
  email: string
  avatar_url: string | null
}

interface SupabaseProject {
  id: string
  name: string
  ref: string
  region: string
  status: string
}

interface DeviceCodeData {
  user_code: string
  device_code: string
  interval: number
  expires_in: number
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function deployStateColor(state: string): string {
  switch (state?.toUpperCase()) {
    case 'READY': return 'text-green-400 fill-green-400'
    case 'BUILDING': return 'text-amber-400 fill-amber-400'
    case 'ERROR': case 'DEPLOYMENT_ERROR': return 'text-red-400 fill-red-400'
    case 'QUEUED': return 'text-[var(--accent-cyan)] fill-[var(--accent-cyan)]'
    case 'CANCELED': return 'text-white/30 fill-white/30'
    default: return 'text-white/40 fill-white/40'
  }
}

function deployStateLabel(state: string): string {
  switch (state?.toUpperCase()) {
    case 'READY': return 'Ready'
    case 'BUILDING': return 'Building'
    case 'ERROR': case 'DEPLOYMENT_ERROR': return 'Error'
    case 'QUEUED': return 'Queued'
    case 'CANCELED': return 'Canceled'
    default: return state
  }
}

function getCanvasBounds(): { x: number; y: number; width: number; height: number } | null {
  const el = document.querySelector('[data-canvas-panel]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

/** Extract owner/repo from a GitHub remote URL */
function parseRepoName(url: string): string | null {
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/)
  return match?.[1] || null
}

/** Full-screen overlay showing the GitHub device code */
function GitHubCodeOverlay({
  code,
  onContinue,
  onCancel
}: {
  code: string
  onContinue: () => void
  onCancel: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      () => {
        const input = document.createElement('input')
        input.value = code
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
        setCopied(true)
      }
    )
  }, [code])

  useEffect(() => {
    navigator.clipboard.writeText(code).catch(() => {})
  }, [code])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="relative bg-[var(--bg-secondary)] rounded-2xl p-10 w-[400px] text-center border border-white/10 shadow-2xl"
        initial={{ scale: 0.92, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 4 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X size={14} className="text-white/30" />
        </button>

        <Github size={36} className="mx-auto mb-5 text-white/50" />
        <h2 className="text-lg font-semibold text-white mb-1.5">Connect to GitHub</h2>
        <p className="text-sm text-white/40 mb-8 leading-relaxed">
          Copy this code, then enter it on GitHub to authorize Claude Canvas.
        </p>

        <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-3 font-medium">
          Your verification code
        </div>

        <button
          onClick={copyCode}
          className="group w-full flex items-center justify-center gap-3 font-mono text-[28px] font-bold tracking-[5px] text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/[0.06] border border-[var(--accent-cyan)]/20 rounded-xl py-5 px-6 hover:bg-[var(--accent-cyan)]/[0.12] hover:border-[var(--accent-cyan)]/30 transition-all cursor-pointer mb-2"
        >
          <span>{code}</span>
          {copied ? (
            <Check size={18} className="text-green-400 shrink-0" />
          ) : (
            <Copy size={18} className="text-[var(--accent-cyan)]/60 group-hover:text-[var(--accent-cyan)] shrink-0 transition-colors" />
          )}
        </button>

        <div className="text-xs h-5 mb-6">
          {copied ? (
            <span className="text-green-400">Copied to clipboard!</span>
          ) : (
            <span className="text-white/25">Click to copy</span>
          )}
        </div>

        <button
          onClick={() => {
            copyCode()
            onContinue()
          }}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#238636] hover:bg-[#2ea043] text-white font-semibold rounded-xl transition-colors text-sm"
        >
          Continue to GitHub <ArrowRight size={15} />
        </button>

        <p className="text-[11px] text-white/20 mt-4">Press Escape to cancel</p>
      </motion.div>
    </motion.div>
  )
}

// ─── V9 Linear Expandable: shared presentational sub-components ───────────

function CompactTopBar({ iconBg, icon, name, statusColor, statusLabel }: {
  iconBg: string
  icon: ReactNode
  name: string
  statusColor: string
  statusLabel: string
}) {
  return (
    <div className="flex items-center gap-2.5 px-[14px] py-3">
      <div
        className="w-6 h-6 rounded-[6px] flex items-center justify-center shrink-0"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <span className="text-[13px] font-semibold flex-1 text-[var(--v9-t1)]">{name}</span>
      <div
        className="flex items-center gap-[5px]"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 500, color: statusColor }}
      >
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
        {statusLabel}
      </div>
    </div>
  )
}

function HeroSection({ value, valueColor, label, tag }: {
  value: string
  valueColor: string
  label: string
  tag?: ReactNode
}) {
  return (
    <div className="flex items-end gap-3 px-[14px] pb-3">
      <div className="flex-1">
        <div
          className="text-[28px] font-bold leading-none"
          style={{ letterSpacing: '-0.02em', color: valueColor }}
        >
          {value}
        </div>
        <div className="text-xs text-[var(--v9-t3)] mt-[3px]">{label}</div>
      </div>
      {tag && <div className="pb-[2px]">{tag}</div>}
    </div>
  )
}

function MetricsRow({ metrics }: {
  metrics: Array<{ value: string; label: string; color?: string }>
}) {
  return (
    <div className="flex px-[14px] pb-2.5">
      {metrics.map((m, i) => (
        <div key={i} className="flex-1 text-center py-1.5 relative">
          {i > 0 && (
            <div className="absolute left-0 top-1 bottom-1 w-px bg-white/[0.06]" />
          )}
          <div
            className="text-[13px] font-semibold"
            style={{ fontFamily: 'var(--font-mono)', color: m.color || 'var(--v9-t1)' }}
          >
            {m.value}
          </div>
          <div className="text-[9px] text-[var(--v9-t3)] mt-px">{m.label}</div>
        </div>
      ))}
    </div>
  )
}

function ExpandToggle({ expanded, onToggle }: {
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className="flex items-center justify-center px-[14px] py-1.5 border-t border-white/[0.06] cursor-pointer hover:bg-white/[0.02] select-none"
    >
      <span
        className="flex items-center gap-1 text-[var(--v9-t3)]"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '9px' }}
      >
        <span
          className="text-[10px] transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
        >
          ▾
        </span>
        More
      </span>
    </div>
  )
}

function AccentSection({ color, opacity = 1, last, children }: {
  color: string
  opacity?: number
  last?: boolean
  children: ReactNode
}) {
  return (
    <div className={`relative px-[14px] py-2.5 ${last ? '' : 'border-b border-white/[0.06]'}`}>
      <div
        className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-sm"
        style={{ background: color, opacity }}
      />
      {children}
    </div>
  )
}

export function ServiceIcons() {
  const [status, setStatus] = useState<ServiceStatus>({
    github: false,
    vercel: false,
    supabase: false
  })
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null)
  const [vercelUser, setVercelUser] = useState<VercelUser | null>(null)
  const [repoName, setRepoName] = useState<string | null>(null)
  // Ref+state mirror: ref is synchronous (readable in same render cycle),
  // state triggers re-renders. This prevents the race condition where
  // setDropdownOpen(null) is async but fetch effects read stale state.
  const dropdownOpenRef = useRef<string | null>(null)
  const [dropdownOpen, _setDropdownOpen] = useState<string | null>(null)
  const setDropdownOpen = useCallback((value: string | null) => {
    dropdownOpenRef.current = value
    _setDropdownOpen(value)
  }, [])
  // Generation counter: incremented on tab switch, checked in async callbacks
  // to discard stale responses from the previous tab's fetches.
  const fetchGenRef = useRef(0)
  // Inflight dedup: tracks in-progress bootstrap fetches by "tabId:path".
  // Prevents duplicate requests without preventing retries after discard.
  // Refs survive StrictMode double-mount (same object across mount cycles).
  const vercelInflightRef = useRef(new Set<string>())
  const supabaseInflightRef = useRef(new Set<string>())
  const [connecting, setConnecting] = useState<string | null>(null)
  const [creatingRepo, setCreatingRepo] = useState(false)
  const [showRepoInput, setShowRepoInput] = useState(false)
  const [showLinkRepo, setShowLinkRepo] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [availableRepos, setAvailableRepos] = useState<Array<{ name: string; full_name: string; html_url: string; private: boolean }>>([])
  const [repoSearchQuery, setRepoSearchQuery] = useState('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [codeData, setCodeData] = useState<DeviceCodeData | null>(null)
  const codeDataRef = useRef<DeviceCodeData | null>(null)

  // Git sync state from active tab
  const [prInfo, setPrInfo] = useState<{ number: number; url: string; title: string } | null>(null)
  const [loadingPr, setLoadingPr] = useState(false)
  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)

  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = useActiveTab()
  const gitAhead = activeTab?.gitAhead ?? 0
  const gitBehind = activeTab?.gitBehind ?? 0
  const gitRemoteConfigured = activeTab?.gitRemoteConfigured ?? false
  const gitFetchError = activeTab?.gitFetchError ?? null
  const lastPushTime = activeTab?.lastPushTime ?? null
  const lastFetchTime = activeTab?.lastFetchTime ?? null

  // Vercel-specific state
  const [vercelProjects, setVercelProjects] = useState<VercelProject[]>([])
  const [showVercelProjects, setShowVercelProjects] = useState(false)
  const [vercelProjectSearch, setVercelProjectSearch] = useState('')
  const [loadingVercelProjects, setLoadingVercelProjects] = useState(false)
  const [linkedProject, setLinkedProject] = useState<LinkedProjectData | null>(null)
  const [loadingLinkedProject, setLoadingLinkedProject] = useState(false)
  const [importingProject, setImportingProject] = useState(false)
  const [recentDeploys, setRecentDeploys] = useState<Array<{
    id: string; url: string; state: string; created: number; source: string | null
  }>>([])

  // Supabase-specific state
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null)
  const [supabaseProjects, setSupabaseProjects] = useState<SupabaseProject[]>([])
  const [linkedSupabaseProject, setLinkedSupabaseProject] = useState<SupabaseProject | null>(null)
  const [loadingSupabaseProject, setLoadingSupabaseProject] = useState(false)
  const [supabaseTables, setSupabaseTables] = useState<Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>>([])
  const [supabaseFunctions, setSupabaseFunctions] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [supabaseBuckets, setSupabaseBuckets] = useState<Array<{ id: string; name: string; public: boolean }>>([])
  const [supabasePolicies, setSupabasePolicies] = useState<Array<{ table: string; name: string; command: string }>>([])
  const [showSupabaseTables, setShowSupabaseTables] = useState(false)
  const [showSupabaseFunctions, setShowSupabaseFunctions] = useState(false)
  const [showSupabaseBuckets, setShowSupabaseBuckets] = useState(false)
  const [showSupabasePolicies, setShowSupabasePolicies] = useState(false)
  const [supabaseConnectionInfo, setSupabaseConnectionInfo] = useState<{ url: string; anonKey: string; dbUrl: string } | null>(null)
  const [copiedSupabaseUrl, setCopiedSupabaseUrl] = useState(false)
  const [showSupabaseProjectPicker, setShowSupabaseProjectPicker] = useState(false)
  const [supabaseProjectSearch, setSupabaseProjectSearch] = useState('')
  const [showCreateSupabaseProject, setShowCreateSupabaseProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectRegion, setNewProjectRegion] = useState('us-east-1')
  const [newProjectDbPass, setNewProjectDbPass] = useState('')
  const [creatingSupabaseProject, setCreatingSupabaseProject] = useState(false)
  const [expandedDropdown, setExpandedDropdown] = useState<string | null>(null)

  codeDataRef.current = codeData

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) {
      setExpandedDropdown(null)
      setShowRepoInput(false)
      setShowLinkRepo(false)
      setNewRepoName('')
      setRepoSearchQuery('')
      setCreatingRepo(false)
      setShowVercelProjects(false)
      setVercelProjectSearch('')
      setShowSupabaseTables(false)
      setShowSupabaseFunctions(false)
      setShowSupabaseBuckets(false)
      setShowSupabasePolicies(false)
      setShowSupabaseProjectPicker(false)
      setSupabaseProjectSearch('')
      setShowCreateSupabaseProject(false)
      setNewProjectName('')
      setNewProjectDbPass('')
      return
    }
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-service-dropdown]')) {
        setDropdownOpen(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  // Escape key closes overlays
  useEffect(() => {
    if (!codeData) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCodeData(null)
        setConnecting(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [codeData])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+G — Open on GitHub
      if (e.metaKey && e.shiftKey && e.key === 'G') {
        e.preventDefault()
        if (repoName) {
          window.open(`https://github.com/${repoName}`, '_blank')
        }
      }
      // Cmd+Shift+V — Open Vercel Dashboard
      if (e.metaKey && e.shiftKey && e.key === 'V') {
        e.preventDefault()
        if (status.vercel && vercelUser && linkedProject) {
          window.open(
            `https://vercel.com/${vercelUser.username}/${linkedProject.project.name}`,
            '_blank'
          )
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [repoName, status.vercel, vercelUser, linkedProject])

  // Fetch service statuses + user info on mount
  // OAuth tokens are app-global (not per-project), so no need to re-fetch on tab switch
  useEffect(() => {
    const fetchStatus = () => {
      Promise.all([
        window.api.oauth.github.status(),
        window.api.oauth.vercel.status(),
        window.api.oauth.supabase.status()
      ]).then(([gh, vc, sb]) => {
        const ghData = gh as { connected: boolean; login?: string; avatar_url?: string }
        const sbData = sb as { connected: boolean; name?: string; email?: string; avatar_url?: string | null }
        setStatus({
          github: ghData.connected,
          vercel: vc.connected,
          supabase: sbData.connected
        })
        if (ghData.connected && ghData.login) {
          setGithubUser({ login: ghData.login, avatar_url: ghData.avatar_url || '' })
        }
        if (vc.connected && vc.username) {
          setVercelUser({ username: vc.username, name: vc.name ?? null, avatar: vc.avatar ?? null })
        }
        if (sbData.connected && sbData.name) {
          setSupabaseUser({ name: sbData.name, email: sbData.email || '', avatar_url: sbData.avatar_url || null })
        }
      })
    }
    fetchStatus()
    // Re-check when window regains focus (user may have connected/disconnected in browser)
    window.addEventListener('focus', fetchStatus)
    return () => window.removeEventListener('focus', fetchStatus)
  }, [])

  // Listen for Supabase session expiry (refresh token revoked/invalid)
  useEffect(() => {
    const cleanup = window.api.oauth.supabase.onExpired(() => {
      console.log('[TAB-DEBUG] ServiceIcons: Supabase session expired — marking disconnected')
      setStatus((prev) => ({ ...prev, supabase: false }))
      setSupabaseUser(null)
      setLinkedSupabaseProject(null)
      const tabId = useTabsStore.getState().activeTabId
      if (tabId) {
        useTabsStore.getState().updateTab(tabId, {
          supabaseBootstrapped: false,
          supabaseLinkedProject: null
        })
      }
      useToastStore.getState().addToast('Supabase session expired — reconnect to continue', 'error')
    })
    return cleanup
  }, [])

  // Close any open dropdown when switching tabs.
  // useLayoutEffect fires BEFORE useEffect in the same render, so fetch effects
  // below will see the updated dropdownOpenRef.current === null.
  // Triggers on activeTabId (atomic) — NOT project store path (delayed).
  const currentProject = useProjectStore((s) => s.currentProject)
  const prevTabIdRef = useRef(activeTabId)

  useLayoutEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      const oldTabId = prevTabIdRef.current
      prevTabIdRef.current = activeTabId
      // Bump generation so in-flight fetches from the old tab are discarded
      fetchGenRef.current += 1
      // Close dropdown synchronously via ref (effects below read ref, not state)
      setDropdownOpen(null)
      console.log(`[TAB-DEBUG] ServiceIcons: tab switched ${oldTabId?.slice(-6) || 'none'} → ${activeTabId?.slice(-6) || 'none'}, gen=${fetchGenRef.current}, dropdown closed`)
    }
  }, [activeTabId, setDropdownOpen])

  // Load cached integration state from tab store when active tab changes.
  // When no tab is active (home screen), clear all integration local state.
  useEffect(() => {
    if (!activeTabId) {
      setRepoName(null)
      setLinkedProject(null)
      setLinkedSupabaseProject(null)
      setCurrentBranch(null)
      setLocalBranches([])
      setPrInfo(null)
      return
    }
    const tab = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    // Restore cached values — if null, the fetch effects below will populate them
    if (tab.githubRepoName !== undefined) setRepoName(tab.githubRepoName)
    if (tab.vercelLinkedProject !== undefined) setLinkedProject(tab.vercelLinkedProject)
    if (tab.supabaseLinkedProject !== undefined) {
      setLinkedSupabaseProject(tab.supabaseLinkedProject)
      window.api.mcp.supabaseLinked(tab.supabaseLinkedProject?.ref || null)
    }
    console.log(`[TAB-DEBUG] ServiceIcons: cache load for ${tab.project.name} — github=${tab.githubRepoName || 'null'}, vercel=${tab.vercelLinkedProject ? 'linked' : 'null'}, supabase=${tab.supabaseLinkedProject ? 'linked' : 'null'}`)
  }, [activeTabId])

  // Bootstrap GitHub repo remote on project load (background, non-blocking).
  // Same invariants as Vercel/Supabase bootstrap:
  // 1. "bootstrapped" is set ONLY after response is successfully applied
  // 2. If response is discarded (gen changed), flag stays false → retry on next switch back
  // 3. Reads path from tab store (atomic) — NOT project store (delayed by one render)
  useEffect(() => {
    if (!status.github || !activeTabId) return
    const tab = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    const tabPath = tab.project.path
    const capturedTabId = activeTabId

    // Guard: Already resolved — use cached value
    if (tab.githubBootstrapped) {
      console.log(`[TAB-DEBUG] ServiceIcons: GitHub bootstrap SKIP — resolved (tab ${capturedTabId.slice(-6)}, cached=${tab.githubRepoName || 'none'})`)
      if (tab.githubRepoName) setRepoName(tab.githubRepoName)
      return
    }

    const gen = fetchGenRef.current
    console.log(`[TAB-DEBUG] ServiceIcons: GitHub bootstrap FETCH (tab ${capturedTabId.slice(-6)}, path=${tabPath.split('/').pop()}, gen=${gen})`)
    window.api.git.getProjectInfo(tabPath).then(({ remoteUrl, error }) => {
      if (fetchGenRef.current !== gen) {
        console.log(`[TAB-DEBUG] ServiceIcons: GitHub bootstrap discarded (gen ${gen} → ${fetchGenRef.current}) — will retry`)
        return
      }
      // Transient failure — keep cached repo name, do NOT mark bootstrapped (will retry)
      if (error) {
        const cached = useTabsStore.getState().tabs.find((t) => t.id === capturedTabId)
        if (cached?.githubRepoName) setRepoName(cached.githubRepoName)
        console.log(`[TAB-DEBUG] ServiceIcons: GitHub bootstrap ERROR — will retry (tab ${capturedTabId.slice(-6)})`)
        return
      }
      const name = remoteUrl ? parseRepoName(remoteUrl) : null
      // Don't overwrite a known-good cached repo name with null.
      if (!name) {
        const cached = useTabsStore.getState().tabs.find((t) => t.id === capturedTabId)
        if (cached?.githubRepoName) {
          console.log(`[TAB-DEBUG] ServiceIcons: GitHub bootstrap returned none — keeping cached ${cached.githubRepoName} (tab ${capturedTabId.slice(-6)})`)
          setRepoName(cached.githubRepoName)
          useTabsStore.getState().updateTab(capturedTabId, { githubBootstrapped: true })
          return
        }
      }
      console.log(`[TAB-DEBUG] ServiceIcons: GitHub detected — ${name || 'none'} (tab ${capturedTabId.slice(-6)})`)
      setRepoName(name)
      // Persist to tab store — mark bootstrapped ONLY on successful apply
      const currentActive = useTabsStore.getState().activeTabId
      if (currentActive === capturedTabId) {
        useTabsStore.getState().updateTab(capturedTabId, {
          githubBootstrapped: true,
          githubRepoName: name
        })
      }
    }).catch(() => {
      console.log(`[TAB-DEBUG] ServiceIcons: GitHub bootstrap ERROR — will retry (tab ${capturedTabId.slice(-6)})`)
    })
  }, [status.github, activeTabId])

  // Bootstrap Vercel linked project on project load (background, non-blocking).
  //
  // Key invariants:
  // 1. "bootstrapped" is set ONLY after response is successfully applied (not at fetch start)
  // 2. If response is discarded (gen changed), flag stays false → retry on next switch back
  // 3. Inflight dedup via ref (keyed by tabId:path) prevents duplicate concurrent fetches
  // 4. Path read from tab store (atomic), not project store (delayed)
  useEffect(() => {
    if (!activeTabId) return
    const tab = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    const tabPath = tab.project.path

    // Guard 1: OAuth must be connected first.
    if (!status.vercel) {
      console.log(`[TAB-DEBUG] ServiceIcons: Vercel bootstrap SKIP — not connected (tab ${activeTabId.slice(-6)})`)
      return
    }
    // Guard 2: Already resolved (bootstrapped=true means we have a definitive answer)
    if (tab.vercelBootstrapped) {
      console.log(`[TAB-DEBUG] ServiceIcons: Vercel bootstrap SKIP — resolved (tab ${activeTabId.slice(-6)}, cached=${tab.vercelLinkedProject ? 'linked' : 'not_linked'})`)
      if (tab.vercelLinkedProject) setLinkedProject(tab.vercelLinkedProject)
      return
    }
    // Guard 3: Inflight dedup — prevent duplicate concurrent fetches
    const inflightKey = `${activeTabId}:${tabPath}`
    if (vercelInflightRef.current.has(inflightKey)) {
      console.log(`[TAB-DEBUG] ServiceIcons: Vercel bootstrap SKIP — inflight (tab ${activeTabId.slice(-6)})`)
      return
    }
    vercelInflightRef.current.add(inflightKey)

    const capturedTabId = activeTabId
    const gen = fetchGenRef.current
    console.log(`[TAB-DEBUG] ServiceIcons: Vercel bootstrap FETCH (tab ${capturedTabId.slice(-6)}, path=${tabPath.split('/').pop()}, gen=${gen})`)

    window.api.oauth.vercel.linkedProject({
      projectPath: tabPath,
      gitRepo: repoName || undefined
    }).then((result) => {
      vercelInflightRef.current.delete(inflightKey)

      if (fetchGenRef.current !== gen) {
        // Discarded — do NOT mark bootstrapped. Next switch back will retry.
        console.log(`[TAB-DEBUG] ServiceIcons: Vercel bootstrap discarded (gen ${gen} → ${fetchGenRef.current}) — will retry`)
        return
      }
      const currentTab = useTabsStore.getState().tabs.find((t) => t.id === capturedTabId)
      if (!currentTab || currentTab.project.path !== tabPath) return

      if ('linked' in result && result.linked) {
        console.log(`[TAB-DEBUG] ServiceIcons: Vercel detected — ${result.project.name} (tab ${capturedTabId.slice(-6)})`)
        setLinkedProject(result)
        useTabsStore.getState().updateTab(capturedTabId, {
          vercelBootstrapped: true, // Mark done ONLY on successful apply
          vercelLinkedProject: result,
          lastIntegrationFetch: Date.now()
        })
      } else {
        console.log(`[TAB-DEBUG] ServiceIcons: Vercel — not linked (tab ${capturedTabId.slice(-6)})`)
        // Definitively not linked — mark as resolved so we don't re-fetch
        useTabsStore.getState().updateTab(capturedTabId, {
          vercelBootstrapped: true,
        })
      }
    }).catch(() => {
      vercelInflightRef.current.delete(inflightKey)
      // Error — do NOT mark bootstrapped. Will retry on next trigger.
      console.log(`[TAB-DEBUG] ServiceIcons: Vercel bootstrap ERROR — will retry (tab ${capturedTabId.slice(-6)})`)
    })
  }, [status.vercel, activeTabId, repoName])

  // Bootstrap Supabase linked project on project load (background, non-blocking).
  // Same invariants as Vercel bootstrap above.
  useEffect(() => {
    if (!activeTabId) return
    const tab = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    const tabPath = tab.project.path

    // Guard 1: OAuth must be connected first.
    if (!status.supabase) {
      console.log(`[TAB-DEBUG] ServiceIcons: Supabase bootstrap SKIP — not connected (tab ${activeTabId.slice(-6)})`)
      return
    }
    // Guard 2: Already resolved
    if (tab.supabaseBootstrapped) {
      console.log(`[TAB-DEBUG] ServiceIcons: Supabase bootstrap SKIP — resolved (tab ${activeTabId.slice(-6)}, cached=${tab.supabaseLinkedProject ? 'linked' : 'not_linked'})`)
      if (tab.supabaseLinkedProject) setLinkedSupabaseProject(tab.supabaseLinkedProject)
      return
    }
    // Guard 3: Inflight dedup
    const inflightKey = `${activeTabId}:${tabPath}`
    if (supabaseInflightRef.current.has(inflightKey)) {
      console.log(`[TAB-DEBUG] ServiceIcons: Supabase bootstrap SKIP — inflight (tab ${activeTabId.slice(-6)})`)
      return
    }
    supabaseInflightRef.current.add(inflightKey)

    const capturedTabId = activeTabId
    const folderName = tabPath.split('/').pop()?.toLowerCase()
    const gen = fetchGenRef.current
    console.log(`[TAB-DEBUG] ServiceIcons: Supabase bootstrap FETCH (tab ${capturedTabId.slice(-6)}, folder="${folderName}", gen=${gen})`)

    window.api.oauth.supabase.listProjects().then((projects) => {
      supabaseInflightRef.current.delete(inflightKey)

      if (fetchGenRef.current !== gen) {
        console.log(`[TAB-DEBUG] ServiceIcons: Supabase bootstrap discarded (gen ${gen} → ${fetchGenRef.current}) — will retry`)
        return
      }
      if ('error' in projects) return
      const currentTab = useTabsStore.getState().tabs.find((t) => t.id === capturedTabId)
      if (!currentTab || currentTab.project.path !== tabPath) return

      const linked = (projects as SupabaseProject[]).find((p) => p.name.toLowerCase() === folderName)
      if (linked) {
        console.log(`[TAB-DEBUG] ServiceIcons: Supabase detected — ${linked.name} (tab ${capturedTabId.slice(-6)})`)
        setLinkedSupabaseProject(linked)
        window.api.mcp.supabaseLinked(linked.ref)
        useTabsStore.getState().updateTab(capturedTabId, {
          supabaseBootstrapped: true,
          supabaseLinkedProject: linked,
          lastIntegrationFetch: Date.now()
        })
      } else {
        console.log(`[TAB-DEBUG] ServiceIcons: Supabase — not linked for "${folderName}" (tab ${capturedTabId.slice(-6)})`)
        useTabsStore.getState().updateTab(capturedTabId, {
          supabaseBootstrapped: true,
        })
      }
    }).catch(() => {
      supabaseInflightRef.current.delete(inflightKey)
      console.log(`[TAB-DEBUG] ServiceIcons: Supabase bootstrap ERROR — will retry (tab ${capturedTabId.slice(-6)})`)
    })
  }, [status.supabase, activeTabId])

  // Fetch branches and check PR when GitHub dropdown opens.
  // Reads from dropdownOpenRef (synchronous) — safe from the tab-switch race.
  // Double-checks gen before IPC to prevent EBADF from rapid toggle.
  // Uses tab store path (atomic) — NOT project store (delayed).
  useEffect(() => {
    if (dropdownOpenRef.current !== 'github' || !status.github || !activeTabId) return

    const tab = useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    const tabPath = tab.project.path
    const gen = fetchGenRef.current

    // Fetch branches — double-check gen right before IPC to catch rapid switches
    Promise.resolve().then(() => {
      if (fetchGenRef.current !== gen) return // pre-IPC bail
      return window.api.worktree.branches(tabPath).then((result) => {
        if (fetchGenRef.current !== gen) return
        if ('error' in result) return // silently ignore transient failures
        setCurrentBranch(result.current)
        setLocalBranches(result.branches.filter((b: string) => b !== result.current))
      })
    }).catch((err) => {
      if (err?.message?.includes('EBADF')) return // silently ignore fd leak races
    })

    // Check PR status
    if (repoName) {
      Promise.resolve().then(() => {
        if (fetchGenRef.current !== gen) return // pre-IPC bail
        return window.api.git.getProjectInfo(tabPath).then(({ branch, error }) => {
          if (fetchGenRef.current !== gen) return
          if (error) return  // keep existing PR info on transient failure
          if (!branch || branch === 'main' || branch === 'master') {
            setPrInfo(null)
            return
          }
          setLoadingPr(true)
          window.api.oauth.github.prStatus(repoName, branch).then((result) => {
            if (fetchGenRef.current !== gen) return
            if ('hasPR' in result && result.hasPR) {
              setPrInfo({ number: result.number, url: result.url, title: result.title })
            } else {
              setPrInfo(null)
            }
            setLoadingPr(false)
          })
        })
      }).catch(() => {})
    }
  }, [dropdownOpen, status.github, repoName, activeTabId])

  // Send updated bounds during resize while auth view is active
  useEffect(() => {
    if (connecting !== 'github' || codeData) return
    const onResize = () => {
      const bounds = getCanvasBounds()
      if (bounds) window.api.oauth.github.updateBounds(bounds)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [connecting, codeData])

  // Vercel auth view resize
  useEffect(() => {
    if (connecting !== 'vercel') return
    const onResize = () => {
      const bounds = getCanvasBounds()
      if (bounds) window.api.oauth.vercel.updateBounds(bounds)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [connecting])

  // ─── GitHub connect flow ───────────────────────────────────

  const connectGithub = useCallback(async () => {
    setDropdownOpen(null)
    setConnecting('github')

    const result = await window.api.oauth.github.requestCode()

    if ('error' in result) {
      useToastStore.getState().addToast(`GitHub: ${result.error}`, 'error')
      setConnecting(null)
      return
    }

    setCodeData(result)
  }, [])

  const handleContinueToGithub = useCallback(async () => {
    const data = codeDataRef.current
    if (!data) return

    setCodeData(null)

    useWorkspaceStore.getState().openCanvas()

    await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => requestAnimationFrame(r))

    const bounds = getCanvasBounds()
    if (!bounds) {
      useToastStore.getState().addToast('Could not locate canvas panel', 'error')
      setConnecting(null)
      return
    }

    const result = (await window.api.oauth.github.start({
      bounds,
      deviceCode: data.device_code,
      interval: data.interval,
      expiresIn: data.expires_in
    })) as { token: string } | { error: string }

    setConnecting(null)

    if ('token' in result) {
      setStatus((prev) => ({ ...prev, github: true }))
      const statusData = (await window.api.oauth.github.status()) as {
        connected: boolean
        login?: string
        avatar_url?: string
      }
      if (statusData.login) {
        setGithubUser({ login: statusData.login, avatar_url: statusData.avatar_url || '' })
      }
      useToastStore.getState().addToast('Connected to GitHub!', 'success')
    } else if (result.error !== 'Cancelled') {
      useToastStore.getState().addToast(`GitHub: ${result.error}`, 'error')
    }
  }, [])

  const handleCancelAuth = useCallback(() => {
    setCodeData(null)
    setConnecting(null)
    window.api.oauth.github.cancel()
  }, [])

  // ─── Vercel connect flow (Authorization Code + PKCE, fully embedded) ─────

  const connectVercel = useCallback(async () => {
    setDropdownOpen(null)
    setConnecting('vercel')

    useWorkspaceStore.getState().openCanvas()

    await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => requestAnimationFrame(r))

    const bounds = getCanvasBounds()
    if (!bounds) {
      useToastStore.getState().addToast('Could not locate canvas panel', 'error')
      setConnecting(null)
      return
    }

    const result = (await window.api.oauth.vercel.start({ bounds })) as
      | { token: string }
      | { error: string }

    setConnecting(null)

    if ('token' in result) {
      setStatus((prev) => ({ ...prev, vercel: true }))
      const statusData = await window.api.oauth.vercel.status()
      if (statusData.username) {
        setVercelUser({
          username: statusData.username,
          name: statusData.name ?? null,
          avatar: statusData.avatar ?? null
        })
      }
      useToastStore.getState().addToast('Connected to Vercel!', 'success')
    } else if (result.error !== 'Cancelled') {
      useToastStore.getState().addToast(`Vercel: ${result.error}`, 'error')
    }
  }, [])

  const handleCancelVercel = useCallback(() => {
    setConnecting(null)
    window.api.oauth.vercel.cancel()
  }, [])

  // ─── Supabase connect flow (opens system browser) ──────────
  const connectSupabase = useCallback(async () => {
    setDropdownOpen(null)
    setConnecting('supabase')

    const result = await window.api.oauth.supabase.start()
    console.log('[Supabase] start() result:', JSON.stringify(result))

    setConnecting(null)

    if (result && 'token' in result) {
      setStatus((prev) => ({ ...prev, supabase: true }))
      const statusData = await window.api.oauth.supabase.status()
      console.log('[Supabase] status() result:', JSON.stringify(statusData))
      const sb = statusData as { connected: boolean; name?: string; email?: string; avatar_url?: string | null }
      if (sb.name) {
        setSupabaseUser({ name: sb.name, email: sb.email || '', avatar_url: sb.avatar_url || null })
      }
      useToastStore.getState().addToast('Connected to Supabase!', 'success')
    } else if (result && (result as { error?: string }).error !== 'Cancelled') {
      const errMsg = (result as { error?: string }).error || 'Unknown error'
      useToastStore.getState().addToast(`Supabase: ${errMsg}`, 'error')
    } else if (!result) {
      useToastStore.getState().addToast('Supabase: No response from auth', 'error')
    }
  }, [])

  const handleCancelSupabase = useCallback(() => {
    setConnecting(null)
    window.api.oauth.supabase.cancel()
  }, [])

  // Fetch linked Vercel project for current workspace
  const fetchLinkedProject = useCallback(async () => {
    if (!currentProject?.path || !status.vercel) return
    const gen = fetchGenRef.current
    setLoadingLinkedProject(true)
    try {
      const result = await window.api.oauth.vercel.linkedProject({
        projectPath: currentProject.path,
        gitRepo: repoName || undefined
      })
      if (fetchGenRef.current !== gen) return // tab switched, discard
      if ('linked' in result && result.linked) {
        setLinkedProject(result)
        // Persist to tab store
        const tabId = useTabsStore.getState().activeTabId
        if (tabId) useTabsStore.getState().updateTab(tabId, {
          vercelLinkedProject: result,
          lastIntegrationFetch: Date.now()
        })
      } else {
        setLinkedProject(null)
        // Persist null to tab store
        const tabId = useTabsStore.getState().activeTabId
        if (tabId) useTabsStore.getState().updateTab(tabId, { vercelLinkedProject: null })
        // Auto-load all projects when no linked project found
        setLoadingVercelProjects(true)
        const projects = await window.api.oauth.vercel.listProjects()
        if (fetchGenRef.current !== gen) return
        setLoadingVercelProjects(false)
        if (Array.isArray(projects)) {
          setVercelProjects(projects)
          setShowVercelProjects(true)
        } else if (projects && 'error' in projects) {
          console.error('[Vercel] listProjects error:', projects.error)
          setVercelProjects([])
          setShowVercelProjects(true)
        }
      }
    } catch {
      setLinkedProject(null)
    } finally {
      setLoadingLinkedProject(false)
    }
  }, [currentProject?.path, status.vercel, repoName])

  // Refresh Vercel user + linked project when dropdown opens
  useEffect(() => {
    if (dropdownOpenRef.current !== 'vercel') return
    // Always refresh user status when opening dropdown
    if (status.vercel) {
      window.api.oauth.vercel.status().then((vc) => {
        if (vc.connected && vc.username) {
          setVercelUser({
            username: vc.username,
            name: vc.name ?? null,
            avatar: vc.avatar ?? null
          })
        }
      })
    }
    // Fetch linked project
    if (status.vercel && currentProject?.path) {
      fetchLinkedProject()
    }
  }, [dropdownOpen, fetchLinkedProject, status.vercel, currentProject?.path])

  // Fetch recent deployments when linked project is available
  useEffect(() => {
    if (!linkedProject?.project?.id || dropdownOpenRef.current !== 'vercel') return
    const gen = fetchGenRef.current
    window.api.oauth.vercel.deployments(linkedProject.project.id).then((result) => {
      if (fetchGenRef.current !== gen) return
      if (Array.isArray(result)) {
        setRecentDeploys(result.slice(1, 4)) // Skip latest (already shown), take next 3
      }
    }).catch(() => {})
  }, [linkedProject, dropdownOpen])

  // Import current project to Vercel
  const importToVercel = useCallback(async () => {
    if (!currentProject?.path || !repoName) return
    setImportingProject(true)
    try {
      const name = currentProject.path.split('/').pop() || 'project'
      const result = await window.api.oauth.vercel.importProject({
        name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        gitRepo: repoName
      })
      if ('error' in result) {
        useToastStore.getState().addToast(`Import failed: ${result.error}`, 'error')
      } else {
        useToastStore.getState().addToast(`Imported to Vercel! Deploying...`, 'success')
        // Refresh linked project data
        setTimeout(fetchLinkedProject, 2000)
      }
    } catch (err) {
      useToastStore.getState().addToast(`Import failed: ${err}`, 'error')
    } finally {
      setImportingProject(false)
    }
  }, [currentProject?.path, repoName, fetchLinkedProject])

  const openVercelProjects = useCallback(async () => {
    setShowVercelProjects(true)
    setLoadingVercelProjects(true)
    const result = await window.api.oauth.vercel.listProjects()
    setLoadingVercelProjects(false)
    if (!Array.isArray(result)) {
      useToastStore.getState().addToast(`Failed: ${'error' in result ? result.error : 'Unknown'}`, 'error')
      return
    }
    setVercelProjects(result)
  }, [])

  // ─── Supabase project management ──────────────────────────

  const fetchLinkedSupabaseProject = useCallback(async () => {
    if (!currentProject?.path || !status.supabase) return
    const gen = fetchGenRef.current
    setLoadingSupabaseProject(true)

    const projects = await window.api.oauth.supabase.listProjects()
    if (fetchGenRef.current !== gen) return
    if ('error' in projects) {
      setLoadingSupabaseProject(false)
      return
    }

    // Match by folder name
    const folderName = currentProject.path.split('/').pop()?.toLowerCase()
    const linked = (projects as SupabaseProject[]).find((p) => p.name.toLowerCase() === folderName)

    if (linked) {
      setLinkedSupabaseProject(linked)
      // Persist to tab store
      const tabId = useTabsStore.getState().activeTabId
      if (tabId) useTabsStore.getState().updateTab(tabId, {
        supabaseLinkedProject: linked,
        lastIntegrationFetch: Date.now()
      })
      // Fetch all project data in parallel
      const [tables, fns, buckets, policies, connInfo] = await Promise.all([
        window.api.oauth.supabase.listTables(linked.ref),
        window.api.oauth.supabase.listFunctions(linked.ref),
        window.api.oauth.supabase.listBuckets(linked.ref),
        window.api.oauth.supabase.listPolicies(linked.ref),
        window.api.oauth.supabase.getConnectionInfo(linked.ref)
      ])
      if (fetchGenRef.current !== gen) return
      if (Array.isArray(tables)) setSupabaseTables(tables)
      if (Array.isArray(fns)) setSupabaseFunctions(fns)
      if (Array.isArray(buckets)) setSupabaseBuckets(buckets)
      if (Array.isArray(policies)) setSupabasePolicies(policies)
      if (!('error' in connInfo)) setSupabaseConnectionInfo(connInfo)
    } else {
      setSupabaseProjects(projects as SupabaseProject[])
      setShowSupabaseProjectPicker(true)
    }

    setLoadingSupabaseProject(false)
  }, [currentProject?.path, status.supabase])

  const selectSupabaseProject = useCallback(async (project: SupabaseProject) => {
    setLinkedSupabaseProject(project)
    setShowSupabaseProjectPicker(false)
    setLoadingSupabaseProject(true)
    // Tell MCP server which project ref to use
    window.api.mcp.supabaseLinked(project.ref)
    // Persist to tab store (optimistic)
    const tabId = useTabsStore.getState().activeTabId
    if (tabId) useTabsStore.getState().updateTab(tabId, { supabaseLinkedProject: project })

    const [tables, fns, buckets, policies, connInfo] = await Promise.all([
      window.api.oauth.supabase.listTables(project.ref),
      window.api.oauth.supabase.listFunctions(project.ref),
      window.api.oauth.supabase.listBuckets(project.ref),
      window.api.oauth.supabase.listPolicies(project.ref),
      window.api.oauth.supabase.getConnectionInfo(project.ref)
    ])
    if (Array.isArray(tables)) setSupabaseTables(tables)
    if (Array.isArray(fns)) setSupabaseFunctions(fns)
    if (Array.isArray(buckets)) setSupabaseBuckets(buckets)
    if (Array.isArray(policies)) setSupabasePolicies(policies)
    if (!('error' in connInfo)) setSupabaseConnectionInfo(connInfo)

    setLoadingSupabaseProject(false)
  }, [])

  const createSupabaseProject = useCallback(async () => {
    if (!newProjectName.trim() || !newProjectDbPass.trim()) return
    setCreatingSupabaseProject(true)
    const result = await window.api.oauth.supabase.createProject(
      newProjectName.trim(),
      newProjectRegion,
      newProjectDbPass.trim()
    )
    setCreatingSupabaseProject(false)
    if ('error' in result) {
      useToastStore.getState().addToast(`Failed to create project: ${result.error}`, 'error')
      return
    }
    useToastStore.getState().addToast(`Project "${result.name}" created! It may take a minute to become active.`, 'success')
    // Reset form
    setNewProjectName('')
    setNewProjectDbPass('')
    setShowCreateSupabaseProject(false)
    // Select the new project
    selectSupabaseProject(result)
  }, [newProjectName, newProjectRegion, newProjectDbPass, selectSupabaseProject])

  // Refresh Supabase data when dropdown opens
  useEffect(() => {
    if (dropdownOpenRef.current !== 'supabase' || !status.supabase) return
    // Refresh user status
    window.api.oauth.supabase.status().then((sb) => {
      const sbData = sb as { connected: boolean; name?: string; email?: string; avatar_url?: string | null }
      if (sbData.connected && sbData.name) {
        setSupabaseUser({ name: sbData.name, email: sbData.email || '', avatar_url: sbData.avatar_url || null })
      }
    })
    // Fetch project if not already loaded
    if (!linkedSupabaseProject) {
      fetchLinkedSupabaseProject()
    }
  }, [dropdownOpen, status.supabase, linkedSupabaseProject, fetchLinkedSupabaseProject])

  // ─── Generic service actions ───────────────────────────────

  const connectService = useCallback(
    async (key: keyof ServiceStatus) => {
      if (key === 'github') {
        connectGithub()
        return
      }
      if (key === 'vercel') {
        connectVercel()
        return
      }
      if (key === 'supabase') {
        connectSupabase()
        return
      }
    },
    [connectGithub, connectVercel, connectSupabase]
  )

  const disconnectService = useCallback(async (key: keyof ServiceStatus) => {
    await window.api.oauth[key].logout()
    setStatus((prev) => ({ ...prev, [key]: false }))
    const tabId = useTabsStore.getState().activeTabId
    if (key === 'github') {
      setGithubUser(null)
      setRepoName(null)
      if (tabId) useTabsStore.getState().updateTab(tabId, { githubRepoName: null, githubBootstrapped: false })
    }
    if (key === 'vercel') {
      setVercelUser(null)
      setVercelProjects([])
      setLinkedProject(null)
      if (tabId) useTabsStore.getState().updateTab(tabId, { vercelLinkedProject: null })
    }
    if (key === 'supabase') {
      setSupabaseUser(null)
      setLinkedSupabaseProject(null)
      window.api.mcp.supabaseLinked(null)
      setSupabaseTables([])
      setSupabaseFunctions([])
      setSupabaseBuckets([])
      setSupabasePolicies([])
      setSupabaseConnectionInfo(null)
      if (tabId) useTabsStore.getState().updateTab(tabId, { supabaseLinkedProject: null })
    }
    setDropdownOpen(null)
  }, [])

  // ─── GitHub repo management ────────────────────────────────

  const createRepo = useCallback(async (name: string) => {
    const project = useProjectStore.getState().currentProject
    if (!project?.path || !name.trim()) return

    setCreatingRepo(true)
    try {
      const result = await window.api.oauth.github.createRepo({
        name: name.trim(),
        private: true
      })
      if ('error' in result) {
        useToastStore.getState().addToast(`Failed: ${result.error}`, 'error')
        return
      }
      const remoteUrl = `https://github.com/${result.owner}/${name.trim()}.git`
      const setResult = await window.api.git.setRemote(project.path, remoteUrl)
      setShowRepoInput(false)
      setNewRepoName('')

      if ('ok' in setResult) {
        const parsed = `${result.owner}/${name.trim()}`
        setRepoName(parsed)
        // Persist to tab store (optimistic)
        const tabId = useTabsStore.getState().activeTabId
        if (tabId) useTabsStore.getState().updateTab(tabId, { githubRepoName: parsed })
        useToastStore.getState().addToast(`Created ${parsed} — push when ready`, 'success')
      } else {
        useToastStore.getState().addToast(`Repo created but failed to set remote: ${setResult.error}`, 'error')
      }
    } catch (err) {
      useToastStore.getState().addToast(`Failed: ${err}`, 'error')
    } finally {
      setCreatingRepo(false)
    }
  }, [])

  const openLinkRepo = useCallback(async () => {
    setShowLinkRepo(true)
    setShowRepoInput(false)
    setLoadingRepos(true)
    const result = await window.api.oauth.github.listRepos()
    setLoadingRepos(false)
    if (!Array.isArray(result)) {
      useToastStore.getState().addToast(`Failed: ${'error' in result ? result.error : 'Unknown'}`, 'error')
      return
    }
    setAvailableRepos(result)
  }, [])

  const linkRepo = useCallback(async (repo: { full_name: string; html_url: string }) => {
    const project = useProjectStore.getState().currentProject
    if (!project?.path) return

    setCreatingRepo(true)
    try {
      const repoUrl = `https://github.com/${repo.full_name}.git`
      const result = await window.api.git.setRemote(project.path, repoUrl)
      setShowLinkRepo(false)
      setRepoSearchQuery('')

      if ('ok' in result) {
        setRepoName(repo.full_name)
        // Persist to tab store (optimistic)
        const tabId = useTabsStore.getState().activeTabId
        if (tabId) useTabsStore.getState().updateTab(tabId, { githubRepoName: repo.full_name })
        useToastStore.getState().addToast(`Linked to ${repo.full_name}`, 'success')
      } else {
        useToastStore.getState().addToast(`Failed: ${result.error}`, 'error')
      }
    } catch (err) {
      useToastStore.getState().addToast(`Failed: ${err}`, 'error')
    } finally {
      setCreatingRepo(false)
    }
  }, [])

  // ─── Derived state ─────────────────────────────────────────

  const repoShort = repoName?.split('/').pop() || null
  const filteredRepos = repoSearchQuery
    ? availableRepos.filter((r) => r.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase()))
    : availableRepos
  const filteredVercelProjects = vercelProjectSearch
    ? vercelProjects.filter((p) => p.name.toLowerCase().includes(vercelProjectSearch.toLowerCase()))
    : vercelProjects
  const filteredSupabaseProjects = supabaseProjectSearch
    ? supabaseProjects.filter((p) => p.name.toLowerCase().includes(supabaseProjectSearch.toLowerCase()))
    : supabaseProjects

  return (
    <>
      <div className="flex items-center gap-1.5 no-drag relative">
        {/* ─── GitHub ─── */}
        <div className="relative flex items-center" data-service-dropdown>
          <button
            onClick={() => setDropdownOpen(dropdownOpen === 'github' ? null : 'github')}
            className={`flex items-center gap-[7px] h-8 rounded-md transition-all cursor-pointer ${
              status.github && repoName
                ? 'pl-1 pr-2.5 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12]'
                : status.github
                  ? 'pl-1 pr-2.5 border border-dashed border-white/[0.12] bg-transparent hover:bg-white/[0.04]'
                  : 'pl-1 pr-2.5 border border-white/[0.06] bg-transparent opacity-50 hover:opacity-70'
            }`}
            title={`GitHub: ${status.github ? (repoName ? repoName : 'No repo linked') : 'Not connected'}`}
          >
            {/* Avatar square */}
            <div className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 ${
              status.github ? 'bg-[#333]' : 'bg-white/[0.08]'
            }`}>
              {connecting === 'github' && !codeData ? (
                <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
              ) : (
                <Github size={14} className={status.github ? 'text-white' : 'text-white/30'} />
              )}
            </div>
            {/* Two-line text */}
            <div className="flex flex-col min-w-0">
              {status.github && githubUser ? (
                <>
                  <span className="text-[9px] font-medium text-white/35 leading-tight truncate max-w-[100px]">
                    {githubUser.login}
                  </span>
                  <span className={`text-[11px] leading-tight truncate max-w-[120px] ${
                    repoName
                      ? 'font-semibold text-white/85'
                      : 'font-medium text-white/30 italic'
                  }`}>
                    {repoShort || 'No repo'}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-white/20">GitHub</span>
              )}
            </div>
            {/* Status dot — only when linked */}
            {status.github && repoName && (
              <div className="w-[5px] h-[5px] rounded-full bg-green-400 shrink-0 -ml-0.5" />
            )}
          </button>

          <AnimatePresence>
            {dropdownOpen === 'github' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full right-0 mt-1 w-[300px] bg-[var(--v9-surface)] border border-white/[0.06] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.45)] z-[100] overflow-hidden"
              >
                {status.github && githubUser ? (
                  repoName ? (
                    /* ─── Connected + repo linked ─── */
                    <>
                      <CompactTopBar
                        iconBg="#161b22"
                        icon={<Github size={12} className="text-white/70" />}
                        name={githubUser.login}
                        statusColor="var(--v9-green)"
                        statusLabel="Connected"
                      />
                      <HeroSection
                        value={
                          gitAhead > 0 ? `${gitAhead} ahead`
                          : gitBehind > 0 ? `${gitBehind} behind`
                          : gitFetchError ? 'Error'
                          : 'Up to date'
                        }
                        valueColor={
                          gitAhead > 0 ? 'var(--accent-cyan)'
                          : gitBehind > 0 ? 'var(--v9-amber)'
                          : gitFetchError ? 'var(--v9-red)'
                          : 'var(--v9-green)'
                        }
                        label={`${currentBranch || 'branch'} → origin`}
                      />

                      {/* Primary action */}
                      <div className="px-[14px] pb-3">
                        {gitAhead > 0 ? (
                          <button
                            onClick={() => {
                              setDropdownOpen(null)
                              document.querySelector<HTMLButtonElement>('[data-push-button]')?.click()
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-black bg-[var(--accent-cyan)] hover:brightness-110 transition-all"
                          >
                            <ArrowUp size={12} />
                            Push {gitAhead} commit{gitAhead !== 1 ? 's' : ''}
                          </button>
                        ) : gitBehind > 0 ? (
                          <button
                            onClick={() => {
                              setDropdownOpen(null)
                              document.querySelector<HTMLButtonElement>('[data-pull-button]')?.click()
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-black bg-[var(--v9-amber)] hover:brightness-110 transition-all"
                          >
                            <ArrowDown size={12} />
                            Pull {gitBehind} commit{gitBehind !== 1 ? 's' : ''}
                          </button>
                        ) : gitFetchError ? (
                          <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs text-[var(--v9-red)] bg-[var(--v9-red-soft)]">
                            <AlertTriangle size={12} />
                            Remote not found
                          </div>
                        ) : (
                          <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs text-[var(--v9-t3)] bg-white/[0.03]">
                            <Check size={12} />
                            Up to date
                          </div>
                        )}
                      </div>

                      <ExpandToggle
                        expanded={expandedDropdown === 'github'}
                        onToggle={() => setExpandedDropdown(expandedDropdown === 'github' ? null : 'github')}
                      />

                      {/* Expanded panel */}
                      <div
                        className="overflow-hidden transition-all duration-[250ms]"
                        style={{
                          maxHeight: expandedDropdown === 'github' ? '600px' : '0',
                          borderTop: expandedDropdown === 'github' ? '1px solid rgba(255,255,255,0.06)' : '0px solid transparent',
                          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                        {/* Branch info */}
                        <AccentSection color="var(--accent-cyan)">
                          <div className="text-[11px] font-semibold text-[var(--v9-t2)] mb-1.5">Branches</div>
                          {currentBranch && (
                            <div className="flex items-center gap-2 py-1 text-xs">
                              <GitBranch size={10} className="shrink-0 text-[var(--accent-cyan)]" />
                              <span className="text-[var(--v9-t1)] truncate flex-1">{currentBranch}</span>
                              <span className="text-[9px] text-[var(--v9-t4)]" style={{ fontFamily: 'var(--font-mono)' }}>current</span>
                            </div>
                          )}
                          {localBranches.slice(0, 5).map((branch) => (
                            <button
                              key={branch}
                              onClick={async () => {
                                if (!currentProject?.path) return
                                setDropdownOpen(null)
                                try {
                                  const worktrees = await window.api.worktree.list(currentProject.path)
                                  if (!Array.isArray(worktrees)) {
                                    useToastStore.getState().addToast(`Failed: ${'error' in worktrees ? worktrees.error : 'Unknown error'}`, 'error')
                                    return
                                  }
                                  const existing = worktrees.find((w) => w.branch === branch)
                                  if (existing) {
                                    const tabId = useTabsStore.getState().addTab({
                                      name: currentProject.name,
                                      path: existing.path
                                    })
                                    useTabsStore.getState().updateTab(tabId, {
                                      worktreeBranch: existing.branch,
                                      worktreePath: existing.path
                                    })
                                    useToastStore.getState().addToast(`Opened ${branch}`, 'success')
                                    return
                                  }
                                  const mainRoot = worktrees[0]?.path || currentProject.path
                                  const parentDir = mainRoot.replace(/\/[^/]+$/, '')
                                  const targetDir = `${parentDir}/${currentProject.name}-${branch}`
                                  const result = await window.api.worktree.checkout({
                                    projectPath: currentProject.path,
                                    branchName: branch,
                                    targetDir
                                  })
                                  if ('error' in result) {
                                    useToastStore.getState().addToast(`Failed: ${result.error}`, 'error')
                                    return
                                  }
                                  const tabId = useTabsStore.getState().addTab({
                                    name: currentProject.name,
                                    path: result.path
                                  })
                                  useTabsStore.getState().updateTab(tabId, {
                                    worktreeBranch: result.branch,
                                    worktreePath: result.path
                                  })
                                  useToastStore.getState().addToast(`Switched to ${branch}`, 'success')
                                } catch (err: any) {
                                  useToastStore.getState().addToast(`Failed: ${err?.message}`, 'error')
                                }
                              }}
                              className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--v9-t3)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] rounded px-1 -mx-1 transition"
                            >
                              <GitBranch size={10} className="shrink-0" />
                              <span className="truncate flex-1">{branch}</span>
                            </button>
                          ))}
                          {localBranches.length > 5 && (
                            <div className="py-1 text-[10px] text-[var(--v9-t4)]">
                              +{localBranches.length - 5} more
                            </div>
                          )}
                        </AccentSection>

                        {/* PR section */}
                        <AccentSection color="var(--v9-green)" opacity={0.5}>
                          <div className="text-[11px] font-semibold text-[var(--v9-t2)] mb-1.5">Pull Request</div>
                          {loadingPr ? (
                            <div className="flex items-center justify-center py-2">
                              <Loader2 size={12} className="text-[var(--accent-cyan)] animate-spin" />
                            </div>
                          ) : prInfo ? (
                            <button
                              onClick={() => window.open(prInfo.url, '_blank')}
                              className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--v9-green)] hover:brightness-110 transition"
                            >
                              <GitPullRequest size={10} className="shrink-0" />
                              <span className="truncate flex-1">#{prInfo.number} {prInfo.title}</span>
                              <ExternalLink size={9} className="shrink-0 opacity-50" />
                            </button>
                          ) : currentBranch && currentBranch !== 'main' && currentBranch !== 'master' ? (
                            <button
                              onClick={async () => {
                                if (!currentProject?.path) return
                                setDropdownOpen(null)
                                const { addToast } = useToastStore.getState()
                                const msg = await window.api.git.generateCommitMessage(currentProject.path).catch(() => '')
                                const result = await window.api.git.createPr(currentProject.path, {
                                  title: msg || `${currentBranch}`,
                                  body: '',
                                  base: 'main'
                                })
                                if ('url' in result) {
                                  addToast(`PR #${result.number} created`, 'success', {
                                    action: { label: 'Open', onClick: () => window.open(result.url, '_blank') }
                                  })
                                } else {
                                  addToast(`PR failed: ${result.error}`, 'error')
                                }
                              }}
                              className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--accent-cyan)] hover:brightness-110 transition"
                            >
                              <Plus size={10} className="shrink-0" />
                              Create Pull Request
                            </button>
                          ) : (
                            <div className="text-[11px] text-[var(--v9-t4)]">On default branch</div>
                          )}
                        </AccentSection>

                        {/* Actions */}
                        <AccentSection color="var(--v9-t4)" opacity={0.4} last>
                          <button
                            onClick={() => window.open(`https://github.com/${repoName}`, '_blank')}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                          >
                            <ExternalLink size={11} className="shrink-0" />
                            <span className="flex-1">Open on GitHub</span>
                            <span className="text-[9px] text-[var(--v9-t4)]" style={{ fontFamily: 'var(--font-mono)' }}>⌘⇧G</span>
                          </button>
                          {gitAhead > 0 && currentBranch && currentBranch !== 'main' && currentBranch !== 'master' && !prInfo && (
                            <button
                              onClick={async () => {
                                if (!currentProject?.path) return
                                setDropdownOpen(null)
                                const { addToast } = useToastStore.getState()
                                const msg = await window.api.git.generateCommitMessage(currentProject.path).catch(() => '')
                                const result = await window.api.git.createPr(currentProject.path, {
                                  title: msg || `${currentBranch}`,
                                  body: '',
                                  base: 'main'
                                })
                                if ('url' in result) {
                                  addToast(`PR #${result.number} created`, 'success', {
                                    action: { label: 'Open', onClick: () => window.open(result.url, '_blank') }
                                  })
                                } else {
                                  addToast(`PR failed: ${result.error}`, 'error')
                                }
                              }}
                              className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                            >
                              <GitPullRequest size={11} className="shrink-0" />
                              Create Pull Request
                            </button>
                          )}
                        </AccentSection>

                        {/* Footer */}
                        <div className="px-[14px] py-[5px] text-center border-t border-white/[0.06]">
                          <button
                            onClick={() => disconnectService('github')}
                            className="text-[9px] text-[var(--v9-t4)] hover:text-[var(--v9-red)] bg-transparent border-none cursor-pointer"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* ─── Connected, no repo ─── */
                    <>
                      <CompactTopBar
                        iconBg="#161b22"
                        icon={<Github size={12} className="text-white/70" />}
                        name={githubUser.login}
                        statusColor="var(--v9-amber)"
                        statusLabel="No repo"
                      />
                      {showLinkRepo ? (
                        <div className="border-t border-white/[0.06]">
                          <div className="px-[14px] pt-2.5 pb-1">
                            <input
                              autoFocus
                              value={repoSearchQuery}
                              onChange={(e) => setRepoSearchQuery(e.target.value)}
                              placeholder="Search repos..."
                              className="w-full bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] placeholder-[var(--v9-t4)] outline-none focus:border-[var(--accent-cyan)]/40"
                            />
                          </div>
                          <div className="max-h-[200px] overflow-y-auto px-1 pb-1">
                            {loadingRepos ? (
                              <div className="flex items-center justify-center py-3">
                                <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
                              </div>
                            ) : filteredRepos.length === 0 ? (
                              <div className="px-[14px] py-2 text-xs text-[var(--v9-t3)]">No repos found</div>
                            ) : (
                              filteredRepos.slice(0, 20).map((repo) => (
                                <button
                                  key={repo.full_name}
                                  onClick={() => linkRepo(repo)}
                                  disabled={creatingRepo}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--v9-t2)] hover:bg-white/[0.04] rounded-md transition disabled:opacity-50"
                                >
                                  <span className="truncate flex-1 min-w-0">{repo.full_name}</span>
                                  {repo.private && (
                                    <span className="shrink-0 text-[9px] text-[var(--v9-t4)]" style={{ fontFamily: 'var(--font-mono)' }}>private</span>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                          <button
                            onClick={() => { setShowLinkRepo(false); setRepoSearchQuery('') }}
                            className="w-full px-[14px] py-1.5 text-[10px] text-[var(--v9-t4)] hover:text-[var(--v9-t2)] transition border-t border-white/[0.06]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : showRepoInput ? (
                        <div className="px-[14px] py-2.5 border-t border-white/[0.06]">
                          <form
                            onSubmit={(e) => {
                              e.preventDefault()
                              if (newRepoName.trim()) createRepo(newRepoName)
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <input
                              autoFocus
                              value={newRepoName}
                              onChange={(e) => setNewRepoName(e.target.value)}
                              placeholder="repo-name"
                              disabled={creatingRepo}
                              className="flex-1 min-w-0 bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] placeholder-[var(--v9-t4)] outline-none focus:border-[var(--accent-cyan)]/40"
                            />
                            <button
                              type="submit"
                              disabled={creatingRepo || !newRepoName.trim()}
                              className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors disabled:opacity-30"
                            >
                              {creatingRepo ? (
                                <Loader2 size={12} className="text-[var(--accent-cyan)] animate-spin" />
                              ) : (
                                <Check size={12} className="text-[var(--accent-cyan)]" />
                              )}
                            </button>
                          </form>
                        </div>
                      ) : (
                        <div className="border-t border-white/[0.06]">
                          <div className="mx-[14px] my-2.5 flex flex-col items-center gap-2 py-4 px-3 border border-dashed border-white/[0.06] rounded-lg">
                            <Github size={18} className="text-[var(--v9-t4)]" />
                            <div className="text-center">
                              <div className="text-xs text-[var(--v9-t2)]">No repository linked</div>
                              <div className="text-[10px] text-[var(--v9-t4)] mt-0.5">Connect a repo to push, pull, and create PRs</div>
                            </div>
                          </div>
                          <button
                            onClick={openLinkRepo}
                            className="w-full flex items-center gap-2 px-[14px] py-2 text-xs text-left text-[var(--v9-t2)] hover:bg-white/[0.04] transition"
                          >
                            <GitBranch size={11} className="shrink-0" />
                            Link Existing Repo
                          </button>
                          <button
                            onClick={() => {
                              const project = useProjectStore.getState().currentProject
                              setNewRepoName(project?.path?.split('/').pop() || '')
                              setShowRepoInput(true)
                            }}
                            className="w-full flex items-center gap-2 px-[14px] py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/[0.04] transition"
                          >
                            <Plus size={11} className="shrink-0" />
                            Create New Repo
                          </button>
                        </div>
                      )}
                      {/* Footer: Disconnect */}
                      <div className="px-[14px] py-[5px] text-center border-t border-white/[0.06]">
                        <button
                          onClick={() => disconnectService('github')}
                          className="text-[9px] text-[var(--v9-t4)] hover:text-[var(--v9-red)] bg-transparent border-none cursor-pointer"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  /* ─── Disconnected ─── */
                  <div className="p-5 text-center">
                    <div className="w-10 h-10 rounded-[10px] bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                      <Github size={20} className="text-[var(--v9-t4)]" />
                    </div>
                    <p className="text-xs text-[var(--v9-t3)] mb-4 leading-relaxed">
                      Push code, create PRs, and<br />collaborate with your team.
                    </p>
                    <button
                      onClick={() => connectService('github')}
                      className="w-full py-2 text-xs font-semibold text-white bg-[#238636] hover:bg-[#2ea043] rounded-lg transition-colors"
                    >
                      Connect to GitHub
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-white/[0.06]" />

        {/* ─── Vercel ─── */}
        <div className="relative flex items-center" data-service-dropdown>
          <button
            onClick={() => setDropdownOpen(dropdownOpen === 'vercel' ? null : 'vercel')}
            className={`flex items-center gap-[7px] h-8 rounded-md transition-all cursor-pointer ${
              status.vercel && linkedProject
                ? 'pl-1 pr-2.5 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12]'
                : status.vercel
                  ? 'pl-1 pr-2.5 border border-dashed border-white/[0.12] bg-transparent hover:bg-white/[0.04]'
                  : 'pl-1 pr-2.5 border border-white/[0.06] bg-transparent opacity-50 hover:opacity-70'
            }`}
            title={`Vercel: ${status.vercel ? (linkedProject ? linkedProject.project.name : 'No project linked') : 'Not connected'}`}
          >
            {/* Avatar square */}
            <div className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 ${
              status.vercel ? 'bg-[#111]' : 'bg-white/[0.08]'
            }`}>
              {connecting === 'vercel' ? (
                <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
              ) : (
                <Triangle size={14} className={status.vercel ? 'text-white' : 'text-white/30'} fill={status.vercel ? 'white' : 'currentColor'} />
              )}
            </div>
            {/* Two-line text */}
            <div className="flex flex-col min-w-0">
              {status.vercel && vercelUser ? (
                <>
                  <span className="text-[9px] font-medium text-white/35 leading-tight truncate max-w-[100px]">
                    {vercelUser.username}
                  </span>
                  <span className={`text-[11px] leading-tight truncate max-w-[120px] ${
                    linkedProject
                      ? 'font-semibold text-white/85'
                      : 'font-medium text-white/30 italic'
                  }`}>
                    {linkedProject?.project.name || 'No project'}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-white/20">Vercel</span>
              )}
            </div>
            {/* Status dot — only when linked */}
            {status.vercel && linkedProject && (
              <div className="w-[5px] h-[5px] rounded-full bg-green-400 shrink-0 -ml-0.5" />
            )}
          </button>

          <AnimatePresence>
            {dropdownOpen === 'vercel' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full right-0 mt-1 w-[300px] bg-[var(--v9-surface)] border border-white/[0.06] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.45)] z-[100] overflow-hidden"
              >
                {status.vercel ? (
                  loadingLinkedProject ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={16} className="text-[var(--accent-cyan)] animate-spin" />
                    </div>
                  ) : linkedProject ? (
                    /* ─── Connected + project linked ─── */
                    <>
                      <CompactTopBar
                        iconBg="#000"
                        icon={<Triangle size={11} className="text-white" fill="white" />}
                        name={linkedProject.project.name}
                        statusColor={
                          linkedProject.latestDeployment
                            ? linkedProject.latestDeployment.state.toUpperCase() === 'READY' ? 'var(--v9-green)'
                            : linkedProject.latestDeployment.state.toUpperCase() === 'BUILDING' ? 'var(--v9-amber)'
                            : linkedProject.latestDeployment.state.toUpperCase() === 'ERROR' || linkedProject.latestDeployment.state.toUpperCase() === 'DEPLOYMENT_ERROR' ? 'var(--v9-red)'
                            : 'var(--v9-t3)'
                            : 'var(--v9-t3)'
                        }
                        statusLabel={linkedProject.latestDeployment ? deployStateLabel(linkedProject.latestDeployment.state) : 'No deploys'}
                      />
                      <HeroSection
                        value={linkedProject.latestDeployment ? deployStateLabel(linkedProject.latestDeployment.state) : 'No deploys'}
                        valueColor={
                          linkedProject.latestDeployment
                            ? linkedProject.latestDeployment.state.toUpperCase() === 'READY' ? 'var(--v9-green)'
                            : linkedProject.latestDeployment.state.toUpperCase() === 'BUILDING' ? 'var(--v9-amber)'
                            : linkedProject.latestDeployment.state.toUpperCase() === 'ERROR' || linkedProject.latestDeployment.state.toUpperCase() === 'DEPLOYMENT_ERROR' ? 'var(--v9-red)'
                            : 'var(--v9-t2)'
                            : 'var(--v9-t2)'
                        }
                        label={
                          linkedProject.latestDeployment
                            ? `${linkedProject.latestDeployment.commitMessage?.slice(0, 30) || 'deployment'} · ${timeAgo(linkedProject.latestDeployment.created)}`
                            : 'No deployments yet'
                        }
                        tag={linkedProject.project.framework ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-white/[0.05] text-[var(--v9-t2)]"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {linkedProject.project.framework}
                          </span>
                        ) : undefined}
                      />

                      <ExpandToggle
                        expanded={expandedDropdown === 'vercel'}
                        onToggle={() => setExpandedDropdown(expandedDropdown === 'vercel' ? null : 'vercel')}
                      />

                      {/* Expanded panel */}
                      <div
                        className="overflow-hidden transition-all duration-[250ms]"
                        style={{
                          maxHeight: expandedDropdown === 'vercel' ? '600px' : '0',
                          borderTop: expandedDropdown === 'vercel' ? '1px solid rgba(255,255,255,0.06)' : '0px solid transparent',
                          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                        {/* URLs */}
                        <AccentSection color="var(--v9-green)">
                          <div className="text-[11px] font-semibold text-[var(--v9-t2)] mb-1.5">URLs</div>
                          <a
                            href={linkedProject.project.productionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 py-[5px] px-2 -mx-2 rounded-md hover:bg-white/[0.03] transition"
                          >
                            <span
                              className="text-[8px] font-semibold uppercase px-[5px] py-px rounded-[3px] shrink-0"
                              style={{ background: 'var(--v9-green-soft)', color: 'var(--v9-green)' }}
                            >
                              Prod
                            </span>
                            <span className="text-[10px] text-[var(--v9-green)] truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                              {linkedProject.project.productionUrl.replace('https://', '')}
                            </span>
                            <span className="text-[11px] text-[var(--v9-t4)]">⎘</span>
                          </a>
                          {linkedProject.latestDeployment?.url && (
                            <a
                              href={linkedProject.latestDeployment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 py-[5px] px-2 -mx-2 rounded-md hover:bg-white/[0.03] transition"
                            >
                              <span
                                className="text-[8px] font-semibold uppercase px-[5px] py-px rounded-[3px] shrink-0"
                                style={{ background: 'rgba(74,234,255,0.08)', color: 'var(--accent-cyan)' }}
                              >
                                Preview
                              </span>
                              <span className="text-[10px] text-[var(--accent-cyan)] truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                                {linkedProject.latestDeployment.url.replace('https://', '')}
                              </span>
                              <span className="text-[11px] text-[var(--v9-t4)]">⎘</span>
                            </a>
                          )}
                        </AccentSection>

                        {/* Recent deploys */}
                        {recentDeploys.length > 0 && (
                          <AccentSection color="var(--v9-t4)">
                            <div className="text-[11px] font-semibold text-[var(--v9-t2)] mb-1.5">Recent</div>
                            {recentDeploys.map((deploy) => (
                              <a
                                key={deploy.id}
                                href={deploy.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 py-[3px] text-[11px] group"
                              >
                                <Circle size={5} className={`shrink-0 ${deployStateColor(deploy.state)}`} />
                                <span className="text-[var(--v9-t2)] flex-1 truncate group-hover:text-[var(--v9-t1)] transition-colors">
                                  {deploy.source ? deploy.source : 'Deployment'}
                                </span>
                                <span className="text-[9px] text-[var(--v9-t4)] shrink-0" style={{ fontFamily: 'var(--font-mono)' }}>
                                  {timeAgo(deploy.created)}
                                </span>
                              </a>
                            ))}
                          </AccentSection>
                        )}

                        {/* Actions */}
                        <AccentSection color="var(--v9-t4)" opacity={0.5} last>
                          <button
                            onClick={async () => {
                              if (!linkedProject.latestDeployment) return
                              const { addToast } = useToastStore.getState()
                              const result = await window.api.oauth.vercel.redeploy(linkedProject.latestDeployment.id)
                              if ('error' in result) {
                                addToast(`Redeploy failed: ${result.error}`, 'error')
                              } else {
                                addToast('Redeploying...', 'success')
                                setTimeout(fetchLinkedProject, 3000)
                              }
                            }}
                            disabled={!linkedProject.latestDeployment}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition disabled:opacity-30"
                          >
                            <RefreshCw size={11} className="shrink-0" />
                            Redeploy
                          </button>
                          <button
                            onClick={() => {
                              const url = `https://vercel.com/${vercelUser?.username}/${linkedProject.project.name}`
                              window.open(url, '_blank')
                            }}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                          >
                            <ExternalLink size={11} className="shrink-0" />
                            <span className="flex-1">Open Dashboard</span>
                            <span className="text-[9px] text-[var(--v9-t4)]" style={{ fontFamily: 'var(--font-mono)' }}>⌘⇧V</span>
                          </button>
                          <button
                            onClick={() => {
                              if (linkedProject.latestDeployment) {
                                window.open(
                                  `https://vercel.com/${vercelUser?.username}/${linkedProject.project.name}/deployments/${linkedProject.latestDeployment.id}`,
                                  '_blank'
                                )
                              }
                            }}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                          >
                            <FileText size={11} className="shrink-0" />
                            Build Logs
                          </button>
                        </AccentSection>

                        {/* Footer */}
                        <div className="px-[14px] py-[5px] text-center border-t border-white/[0.06]">
                          <button
                            onClick={() => disconnectService('vercel')}
                            className="text-[9px] text-[var(--v9-t4)] hover:text-[var(--v9-red)] bg-transparent border-none cursor-pointer"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* ─── Connected, no project ─── */
                    <>
                      <CompactTopBar
                        iconBg="#000"
                        icon={<Triangle size={11} className="text-white" fill="white" />}
                        name={vercelUser?.username || 'Vercel'}
                        statusColor="var(--v9-amber)"
                        statusLabel="No project"
                      />
                      <div className="border-t border-white/[0.06]">
                        <div className="mx-[14px] my-2.5 flex flex-col items-center gap-2 py-4 px-3 border border-dashed border-white/[0.06] rounded-lg">
                          <Triangle size={18} className="text-[var(--v9-t4)]" />
                          <div className="text-center">
                            <div className="text-xs text-[var(--v9-t2)]">No project linked</div>
                            <div className="text-[10px] text-[var(--v9-t4)] mt-0.5">Import or link a project to deploy</div>
                          </div>
                        </div>
                        {repoName && (
                          <button
                            onClick={importToVercel}
                            disabled={importingProject}
                            className="w-full flex items-center gap-2 px-[14px] py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/5 transition border-b border-white/[0.06] disabled:opacity-50"
                          >
                            {importingProject ? (
                              <Loader2 size={11} className="shrink-0 animate-spin" />
                            ) : (
                              <Rocket size={11} className="shrink-0" />
                            )}
                            Import {repoName.split('/').pop()} to Vercel
                          </button>
                        )}
                        <div className="px-[14px] pt-2 pb-1">
                          <div className="text-[10px] uppercase tracking-wider text-[var(--v9-t3)] mb-1.5">
                            Your Projects
                          </div>
                          {vercelProjects.length > 3 && (
                            <input
                              value={vercelProjectSearch}
                              onChange={(e) => setVercelProjectSearch(e.target.value)}
                              placeholder="Search..."
                              className="w-full bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] placeholder-[var(--v9-t4)] outline-none focus:border-[var(--accent-cyan)]/40 mb-1"
                            />
                          )}
                        </div>
                        <div className="max-h-[200px] overflow-y-auto px-1 pb-2">
                          {loadingVercelProjects ? (
                            <div className="flex items-center justify-center py-3">
                              <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
                            </div>
                          ) : filteredVercelProjects.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-[var(--v9-t3)]">
                              {vercelProjectSearch ? 'No matching projects' : 'No projects yet'}
                            </div>
                          ) : (
                            filteredVercelProjects.slice(0, 20).map((project) => (
                              <div
                                key={project.id}
                                className="flex items-center gap-2 py-1.5 px-2 text-xs text-[var(--v9-t2)] hover:bg-white/[0.04] rounded-md transition"
                              >
                                <Triangle size={9} className="shrink-0 text-[var(--v9-t3)]" />
                                <span className="truncate flex-1 min-w-0">{project.name}</span>
                                {project.framework && (
                                  <span className="shrink-0 text-[9px] text-[var(--v9-t4)]">
                                    {project.framework}
                                  </span>
                                )}
                                {project.url && (
                                  <a
                                    href={project.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 p-0.5 text-[var(--v9-t3)] hover:text-[var(--accent-cyan)] transition-colors"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink size={9} />
                                  </a>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="px-[14px] py-[5px] text-center border-t border-white/[0.06]">
                        <button
                          onClick={() => disconnectService('vercel')}
                          className="text-[9px] text-[var(--v9-t4)] hover:text-[var(--v9-red)] bg-transparent border-none cursor-pointer"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  /* ─── Disconnected ─── */
                  <div className="p-5 text-center">
                    <div className="w-10 h-10 rounded-[10px] bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                      <Triangle size={20} className="text-[var(--v9-t4)]" />
                    </div>
                    <p className="text-xs text-[var(--v9-t3)] mb-4 leading-relaxed">
                      Deploy your app and get a<br />live URL in seconds.
                    </p>
                    <button
                      onClick={() => connectService('vercel')}
                      className="w-full py-2 text-xs font-semibold text-black bg-white hover:bg-white/90 rounded-lg transition-colors"
                    >
                      Connect to Vercel
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-white/[0.06]" />

        {/* ─── Supabase ─── */}
        <div className="relative flex items-center" data-service-dropdown>
          <button
            onClick={() => setDropdownOpen(dropdownOpen === 'supabase' ? null : 'supabase')}
            className={`flex items-center gap-[7px] h-8 rounded-md transition-all cursor-pointer ${
              status.supabase && linkedSupabaseProject
                ? 'pl-1 pr-2.5 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12]'
                : status.supabase
                  ? 'pl-1 pr-2.5 border border-dashed border-white/[0.12] bg-transparent hover:bg-white/[0.04]'
                  : 'pl-1 pr-2.5 border border-white/[0.06] bg-transparent opacity-50 hover:opacity-70'
            }`}
            title={`Supabase: ${status.supabase ? (linkedSupabaseProject ? linkedSupabaseProject.name : 'No project linked') : 'Not connected'}`}
          >
            {/* Avatar square */}
            <div className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 ${
              status.supabase ? 'bg-[#2d7a4f]' : 'bg-white/[0.08]'
            }`}>
              {connecting === 'supabase' ? (
                <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
              ) : (
                <Database size={14} className={status.supabase ? 'text-white' : 'text-white/30'} />
              )}
            </div>
            {/* Two-line text */}
            <div className="flex flex-col min-w-0">
              {status.supabase && supabaseUser ? (
                <>
                  <span className="text-[9px] font-medium text-white/35 leading-tight truncate max-w-[100px]">
                    {supabaseUser.name || supabaseUser.email}
                  </span>
                  <span className={`text-[11px] leading-tight truncate max-w-[120px] ${
                    linkedSupabaseProject
                      ? 'font-semibold text-white/85'
                      : 'font-medium text-white/30 italic'
                  }`}>
                    {linkedSupabaseProject?.name || 'No project'}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-white/20">Supabase</span>
              )}
            </div>
            {/* Status dot — only when linked */}
            {status.supabase && linkedSupabaseProject && (
              <div className="w-[5px] h-[5px] rounded-full bg-green-400 shrink-0 -ml-0.5" />
            )}
          </button>

          <AnimatePresence>
            {dropdownOpen === 'supabase' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full right-0 mt-1 w-[300px] bg-[var(--v9-surface)] border border-white/[0.06] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.45)] z-[100] overflow-hidden"
              >
                {status.supabase ? (
                  loadingSupabaseProject ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={16} className="text-[var(--accent-cyan)] animate-spin" />
                    </div>
                  ) : linkedSupabaseProject ? (
                    /* ─── Connected + project linked ─── */
                    <>
                      <CompactTopBar
                        iconBg="#1a3a2a"
                        icon={<Database size={12} className="text-[var(--v9-sb)]" />}
                        name={linkedSupabaseProject.name}
                        statusColor={
                          linkedSupabaseProject.status === 'ACTIVE_HEALTHY' ? 'var(--v9-sb)'
                          : linkedSupabaseProject.status === 'INACTIVE' ? 'var(--v9-amber)'
                          : 'var(--v9-t3)'
                        }
                        statusLabel={
                          linkedSupabaseProject.status === 'ACTIVE_HEALTHY' ? 'Healthy'
                          : linkedSupabaseProject.status === 'INACTIVE' ? 'Inactive'
                          : linkedSupabaseProject.status || 'Unknown'
                        }
                      />
                      <HeroSection
                        value={`${supabaseTables.length}`}
                        valueColor="var(--v9-sb)"
                        label={`tables · ${linkedSupabaseProject.region}`}
                      />

                      <MetricsRow metrics={[
                        { value: `${supabaseTables.length}`, label: 'Tables', color: 'var(--v9-sb)' },
                        { value: `${supabaseFunctions.length}`, label: 'Functions', color: 'var(--v9-violet)' },
                        { value: `${supabasePolicies.length}`, label: 'RLS', color: 'var(--v9-amber)' }
                      ]} />

                      <ExpandToggle
                        expanded={expandedDropdown === 'supabase'}
                        onToggle={() => setExpandedDropdown(expandedDropdown === 'supabase' ? null : 'supabase')}
                      />

                      {/* Expanded panel */}
                      <div
                        className="overflow-hidden transition-all duration-[250ms]"
                        style={{
                          maxHeight: expandedDropdown === 'supabase' ? '600px' : '0',
                          borderTop: expandedDropdown === 'supabase' ? '1px solid rgba(255,255,255,0.06)' : '0px solid transparent',
                          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                        {/* Connection URL */}
                        {supabaseConnectionInfo && (
                          <AccentSection color="var(--v9-sb)">
                            <div className="text-[11px] font-semibold text-[var(--v9-t2)] mb-1.5">Connection</div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(supabaseConnectionInfo.url)
                                setCopiedSupabaseUrl(true)
                                setTimeout(() => setCopiedSupabaseUrl(false), 2000)
                              }}
                              className="flex items-center gap-1.5 py-[5px] px-2 -mx-2 rounded-md hover:bg-white/[0.03] transition w-full text-left group"
                            >
                              <span
                                className="text-[8px] font-semibold uppercase px-[5px] py-px rounded-[3px] shrink-0"
                                style={{ background: 'var(--v9-sb-soft)', color: 'var(--v9-sb)' }}
                              >
                                URL
                              </span>
                              <span className="text-[10px] text-[var(--v9-sb)] truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                                {supabaseConnectionInfo.url.replace('https://', '')}
                              </span>
                              {copiedSupabaseUrl ? (
                                <Check size={9} className="shrink-0 text-[var(--v9-green)]" />
                              ) : (
                                <Copy size={9} className="shrink-0 text-[var(--v9-t4)] group-hover:text-[var(--v9-t2)]" />
                              )}
                            </button>
                          </AccentSection>
                        )}

                        {/* Resources: Tables, Functions, Buckets, Policies */}
                        <AccentSection color="var(--v9-sb)" opacity={0.5}>
                          {/* Tables */}
                          <button
                            onClick={() => setShowSupabaseTables(!showSupabaseTables)}
                            className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--v9-t2)] hover:text-[var(--v9-t1)] transition"
                          >
                            {showSupabaseTables ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>Tables</span>
                            <span className="text-[10px] text-[var(--v9-t4)] ml-auto" style={{ fontFamily: 'var(--font-mono)' }}>{supabaseTables.length}</span>
                          </button>
                          {showSupabaseTables && supabaseTables.length > 0 && (
                            <div className="pl-4 pb-1 max-h-[150px] overflow-y-auto">
                              {supabaseTables.map((t) => (
                                <div key={`${t.schema}.${t.name}`} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span className="text-[var(--v9-t4)] shrink-0">{t.schema}.</span>
                                  <span className="text-[var(--v9-t2)] truncate flex-1">{t.name}</span>
                                  <span className="text-[9px] text-[var(--v9-t4)] shrink-0" style={{ fontFamily: 'var(--font-mono)' }}>{t.columns.length} cols</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Edge Functions */}
                          <button
                            onClick={() => setShowSupabaseFunctions(!showSupabaseFunctions)}
                            className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--v9-t2)] hover:text-[var(--v9-t1)] transition mt-1"
                          >
                            {showSupabaseFunctions ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>Edge Functions</span>
                            <span className="text-[10px] text-[var(--v9-t4)] ml-auto" style={{ fontFamily: 'var(--font-mono)' }}>{supabaseFunctions.length}</span>
                          </button>
                          {showSupabaseFunctions && supabaseFunctions.length > 0 && (
                            <div className="pl-4 pb-1 max-h-[120px] overflow-y-auto">
                              {supabaseFunctions.map((f) => (
                                <div key={f.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span className="text-[var(--v9-t2)] truncate flex-1">{f.name}</span>
                                  <span className={`text-[9px] shrink-0 ${f.status === 'ACTIVE' ? 'text-[var(--v9-green)]' : 'text-[var(--v9-t4)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
                                    {f.status?.toLowerCase()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Storage Buckets */}
                          <button
                            onClick={() => setShowSupabaseBuckets(!showSupabaseBuckets)}
                            className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--v9-t2)] hover:text-[var(--v9-t1)] transition mt-1"
                          >
                            {showSupabaseBuckets ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>Storage Buckets</span>
                            <span className="text-[10px] text-[var(--v9-t4)] ml-auto" style={{ fontFamily: 'var(--font-mono)' }}>{supabaseBuckets.length}</span>
                          </button>
                          {showSupabaseBuckets && supabaseBuckets.length > 0 && (
                            <div className="pl-4 pb-1 max-h-[120px] overflow-y-auto">
                              {supabaseBuckets.map((b) => (
                                <div key={b.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span className="text-[var(--v9-t2)] truncate flex-1">{b.name}</span>
                                  <span className={`text-[9px] shrink-0 px-1.5 py-0.5 rounded-full ${b.public ? 'bg-[var(--v9-amber)]/10 text-[var(--v9-amber)]' : 'bg-white/[0.05] text-[var(--v9-t4)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
                                    {b.public ? 'public' : 'private'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* RLS Policies */}
                          <button
                            onClick={() => setShowSupabasePolicies(!showSupabasePolicies)}
                            className="w-full flex items-center gap-2 py-1 text-xs text-left text-[var(--v9-t2)] hover:text-[var(--v9-t1)] transition mt-1"
                          >
                            {showSupabasePolicies ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>RLS Policies</span>
                            <span className="text-[10px] text-[var(--v9-t4)] ml-auto" style={{ fontFamily: 'var(--font-mono)' }}>{supabasePolicies.length}</span>
                          </button>
                          {showSupabasePolicies && supabasePolicies.length > 0 && (
                            <div className="pl-4 pb-1 max-h-[120px] overflow-y-auto">
                              {supabasePolicies.map((p, i) => (
                                <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span className="text-[var(--v9-t4)] shrink-0">{p.table}</span>
                                  <span className="text-[var(--v9-t2)] truncate flex-1">{p.name}</span>
                                  <span className="text-[9px] text-[var(--v9-t4)] shrink-0" style={{ fontFamily: 'var(--font-mono)' }}>{p.command}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </AccentSection>

                        {/* Actions */}
                        <AccentSection color="var(--v9-t4)" opacity={0.4} last>
                          <button
                            onClick={() => window.open(`https://supabase.com/dashboard/project/${linkedSupabaseProject.ref}`, '_blank')}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                          >
                            <ExternalLink size={11} className="shrink-0" />
                            Open Dashboard
                          </button>
                          <button
                            onClick={() => window.open(`https://supabase.com/dashboard/project/${linkedSupabaseProject.ref}/sql`, '_blank')}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                          >
                            <FileText size={11} className="shrink-0" />
                            SQL Editor
                          </button>
                          <button
                            onClick={() => window.open(`https://supabase.com/dashboard/project/${linkedSupabaseProject.ref}/auth/users`, '_blank')}
                            className="w-full flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md text-xs text-[var(--v9-t2)] hover:text-[var(--v9-t1)] hover:bg-white/[0.04] transition"
                          >
                            <Globe size={11} className="shrink-0" />
                            Auth Settings
                          </button>
                        </AccentSection>

                        {/* Footer */}
                        <div className="px-[14px] py-[5px] text-center border-t border-white/[0.06]">
                          <button
                            onClick={() => disconnectService('supabase')}
                            className="text-[9px] text-[var(--v9-t4)] hover:text-[var(--v9-red)] bg-transparent border-none cursor-pointer"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    </>
                  ) : showCreateSupabaseProject ? (
                    /* ─── Create new project form ─── */
                    <>
                      <CompactTopBar
                        iconBg="#1a3a2a"
                        icon={<Database size={12} className="text-[var(--v9-sb)]" />}
                        name="New Project"
                        statusColor="var(--accent-cyan)"
                        statusLabel="Create"
                      />
                      <div className="border-t border-white/[0.06]">
                        <div className="px-[14px] pt-2 pb-1">
                          <button
                            onClick={() => setShowCreateSupabaseProject(false)}
                            className="flex items-center gap-1 text-[10px] text-[var(--v9-t3)] hover:text-[var(--v9-t2)] transition mb-1.5"
                          >
                            <ArrowLeft size={9} /> Back
                          </button>
                        </div>
                        <div className="px-[14px] pb-3 flex flex-col gap-2">
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-[var(--v9-t3)] mb-1 block">Project Name</label>
                            <input
                              value={newProjectName}
                              onChange={(e) => setNewProjectName(e.target.value)}
                              placeholder="my-app"
                              className="w-full bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] placeholder-[var(--v9-t4)] outline-none focus:border-[var(--accent-cyan)]/40"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-[var(--v9-t3)] mb-1 block">Region</label>
                            <select
                              value={newProjectRegion}
                              onChange={(e) => setNewProjectRegion(e.target.value)}
                              className="w-full bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] outline-none focus:border-[var(--accent-cyan)]/40 appearance-none cursor-pointer"
                            >
                              <option value="us-east-1">US East (N. Virginia)</option>
                              <option value="us-west-1">US West (N. California)</option>
                              <option value="us-west-2">US West (Oregon)</option>
                              <option value="ca-central-1">Canada (Central)</option>
                              <option value="eu-west-1">EU West (Ireland)</option>
                              <option value="eu-west-2">EU West (London)</option>
                              <option value="eu-west-3">EU West (Paris)</option>
                              <option value="eu-central-1">EU Central (Frankfurt)</option>
                              <option value="ap-south-1">Asia Pacific (Mumbai)</option>
                              <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                              <option value="ap-southeast-2">Asia Pacific (Sydney)</option>
                              <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                              <option value="ap-northeast-2">Asia Pacific (Seoul)</option>
                              <option value="sa-east-1">South America (São Paulo)</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-[var(--v9-t3)] mb-1 block">Database Password</label>
                            <input
                              type="password"
                              value={newProjectDbPass}
                              onChange={(e) => setNewProjectDbPass(e.target.value)}
                              placeholder="Strong password (min 6 chars)"
                              className="w-full bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] placeholder-[var(--v9-t4)] outline-none focus:border-[var(--accent-cyan)]/40"
                            />
                          </div>
                          <button
                            onClick={createSupabaseProject}
                            disabled={creatingSupabaseProject || !newProjectName.trim() || newProjectDbPass.trim().length < 6}
                            className="w-full mt-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-medium bg-[var(--v9-sb)]/20 text-[var(--v9-sb)] hover:bg-[var(--v9-sb)]/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            {creatingSupabaseProject ? (
                              <><Loader2 size={12} className="animate-spin" /> Creating...</>
                            ) : (
                              <><Plus size={12} /> Create Project</>
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : showSupabaseProjectPicker ? (
                    /* ─── Project picker ─── */
                    <>
                      <CompactTopBar
                        iconBg="#1a3a2a"
                        icon={<Database size={12} className="text-[var(--v9-sb)]" />}
                        name={supabaseUser?.name || 'Supabase'}
                        statusColor="var(--v9-amber)"
                        statusLabel="Select project"
                      />
                      <div className="border-t border-white/[0.06]">
                        <div className="px-[14px] pt-2 pb-1">
                          <button
                            onClick={() => setShowSupabaseProjectPicker(false)}
                            className="flex items-center gap-1 text-[10px] text-[var(--v9-t3)] hover:text-[var(--v9-t2)] transition mb-1.5"
                          >
                            <ArrowLeft size={9} /> Back
                          </button>
                          <div className="text-[10px] uppercase tracking-wider text-[var(--v9-t3)] mb-1.5">
                            Select Project
                          </div>
                          {supabaseProjects.length > 3 && (
                            <input
                              value={supabaseProjectSearch}
                              onChange={(e) => setSupabaseProjectSearch(e.target.value)}
                              placeholder="Search..."
                              className="w-full bg-white/5 border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-[var(--v9-t1)] placeholder-[var(--v9-t4)] outline-none focus:border-[var(--accent-cyan)]/40 mb-1"
                            />
                          )}
                        </div>
                        <div className="max-h-[200px] overflow-y-auto px-1 pb-2">
                          {filteredSupabaseProjects.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-[var(--v9-t3)]">
                              {supabaseProjectSearch ? 'No matching projects' : 'No projects found'}
                            </div>
                          ) : (
                            filteredSupabaseProjects.map((project) => (
                              <button
                                key={project.id}
                                onClick={() => selectSupabaseProject(project)}
                                className="w-full flex items-center gap-2 py-1.5 px-2 text-xs text-left text-[var(--v9-t2)] hover:bg-white/[0.04] rounded-md transition"
                              >
                                <Database size={9} className="shrink-0 text-[var(--v9-t3)]" />
                                <span className="truncate flex-1">{project.name}</span>
                                <span className="shrink-0 text-[9px] text-[var(--v9-t4)]" style={{ fontFamily: 'var(--font-mono)' }}>{project.region}</span>
                              </button>
                            ))
                          )}
                        </div>
                        {/* Create new project button */}
                        <div className="border-t border-white/[0.06] px-1 py-1">
                          <button
                            onClick={() => {
                              setShowCreateSupabaseProject(true)
                              setShowSupabaseProjectPicker(false)
                              // Pre-fill project name from folder
                              if (currentProject?.path) {
                                const folderName = currentProject.path.split('/').pop() || ''
                                setNewProjectName(folderName)
                              }
                            }}
                            className="w-full flex items-center gap-2 py-1.5 px-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/[0.04] rounded-md transition"
                          >
                            <Plus size={11} className="shrink-0" />
                            Create New Project
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* ─── Connected, no project ─── */
                    <>
                      <CompactTopBar
                        iconBg="#1a3a2a"
                        icon={<Database size={12} className="text-[var(--v9-sb)]" />}
                        name={supabaseUser?.name || 'Supabase'}
                        statusColor="var(--v9-amber)"
                        statusLabel="No project"
                      />
                      <div className="border-t border-white/[0.06]">
                        <div className="mx-[14px] my-2.5 flex flex-col items-center gap-2 py-4 px-3 border border-dashed border-white/[0.06] rounded-lg">
                          <Database size={18} className="text-[var(--v9-t4)]" />
                          <div className="text-center">
                            <div className="text-xs text-[var(--v9-t2)]">No project linked</div>
                            <div className="text-[10px] text-[var(--v9-t4)] mt-0.5">Link a Supabase project for auth, database, and storage</div>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowSupabaseProjectPicker(true)}
                          className="w-full flex items-center gap-2 px-[14px] py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/[0.04] transition"
                        >
                          <Database size={11} className="shrink-0" />
                          Link Existing Project
                        </button>
                        <button
                          onClick={() => {
                            setShowCreateSupabaseProject(true)
                            if (currentProject?.path) {
                              const folderName = currentProject.path.split('/').pop() || ''
                              setNewProjectName(folderName)
                            }
                          }}
                          className="w-full flex items-center gap-2 px-[14px] py-2 text-xs text-left text-[var(--v9-sb)] hover:bg-white/[0.04] transition"
                        >
                          <Plus size={11} className="shrink-0" />
                          Create New Project
                        </button>
                      </div>
                      <div className="px-[14px] py-[5px] text-center border-t border-white/[0.06]">
                        <button
                          onClick={() => disconnectService('supabase')}
                          className="text-[9px] text-[var(--v9-t4)] hover:text-[var(--v9-red)] bg-transparent border-none cursor-pointer"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  /* ─── Disconnected ─── */
                  <div className="p-5 text-center">
                    <div className="w-10 h-10 rounded-[10px] bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                      <Database size={20} className="text-[var(--v9-t4)]" />
                    </div>
                    <p className="text-xs text-[var(--v9-t3)] mb-4 leading-relaxed">
                      Add auth, database, and storage<br />to your app.
                    </p>
                    <button
                      onClick={() => connectService('supabase')}
                      className="w-full py-2 text-xs font-semibold text-white bg-[var(--v9-sb)] hover:brightness-110 rounded-lg transition-all"
                    >
                      Connect to Supabase
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Overlays — rendered via portal to escape overflow clipping */}
      {createPortal(
        <AnimatePresence>
          {codeData && (
            <GitHubCodeOverlay
              code={codeData.user_code}
              onContinue={handleContinueToGithub}
              onCancel={handleCancelAuth}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
