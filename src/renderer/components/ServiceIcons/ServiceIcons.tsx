import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Github, Triangle, Database, Circle, Loader2, Copy, Check, ArrowRight, ArrowUp, ArrowDown, X, Plus, GitBranch, GitPullRequest, Link, ExternalLink, ChevronDown, ChevronRight, Rocket, Clock, FileText, Globe } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useTabsStore } from '@/stores/tabs'

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

export function ServiceIcons() {
  const [status, setStatus] = useState<ServiceStatus>({
    github: false,
    vercel: false,
    supabase: false
  })
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null)
  const [vercelUser, setVercelUser] = useState<VercelUser | null>(null)
  const [repoName, setRepoName] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null)
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

  const activeTab = useTabsStore((s) => {
    const id = s.activeTabId
    return id ? s.tabs.find((t) => t.id === id) ?? null : null
  })
  const gitAhead = activeTab?.gitAhead ?? 0
  const gitBehind = activeTab?.gitBehind ?? 0
  const gitRemoteConfigured = activeTab?.gitRemoteConfigured ?? false
  const lastPushTime = activeTab?.lastPushTime ?? null
  const lastFetchTime = activeTab?.lastFetchTime ?? null

  // Vercel-specific state
  const [vercelProjects, setVercelProjects] = useState<VercelProject[]>([])
  const [showVercelProjects, setShowVercelProjects] = useState(false)
  const [vercelProjectSearch, setVercelProjectSearch] = useState('')
  const [loadingVercelProjects, setLoadingVercelProjects] = useState(false)
  const [linkedProject, setLinkedProject] = useState<LinkedProjectData | null>(null)
  const [loadingLinkedProject, setLoadingLinkedProject] = useState(false)
  const [buildLogs, setBuildLogs] = useState<Array<{ text: string; created: number; type: string }>>([])
  const [showBuildLogs, setShowBuildLogs] = useState(false)
  const [loadingBuildLogs, setLoadingBuildLogs] = useState(false)
  const [importingProject, setImportingProject] = useState(false)
  const [showImportOptions, setShowImportOptions] = useState(false)

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

  codeDataRef.current = codeData

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) {
      setShowRepoInput(false)
      setShowLinkRepo(false)
      setNewRepoName('')
      setRepoSearchQuery('')
      setCreatingRepo(false)
      setShowVercelProjects(false)
      setVercelProjectSearch('')
      setShowBuildLogs(false)
      setBuildLogs([])
      setShowImportOptions(false)
      setShowSupabaseTables(false)
      setShowSupabaseFunctions(false)
      setShowSupabaseBuckets(false)
      setShowSupabasePolicies(false)
      setShowSupabaseProjectPicker(false)
      setSupabaseProjectSearch('')
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

  // Fetch service statuses + user info on mount
  useEffect(() => {
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
  }, [])

  // Fetch repo remote when GitHub is connected and project is loaded
  const currentProject = useProjectStore((s) => s.currentProject)
  useEffect(() => {
    if (!status.github || !currentProject?.path) {
      setRepoName(null)
      return
    }
    window.api.git.getProjectInfo(currentProject.path).then(({ remoteUrl }) => {
      setRepoName(remoteUrl ? parseRepoName(remoteUrl) : null)
    })
  }, [status.github, currentProject?.path])

  // Fetch branches and check PR when GitHub dropdown opens
  useEffect(() => {
    if (dropdownOpen !== 'github' || !status.github) return

    // Fetch branches
    if (currentProject?.path) {
      window.api.worktree.branches(currentProject.path).then((result) => {
        setCurrentBranch(result.current)
        setLocalBranches(result.branches.filter((b: string) => b !== result.current))
      }).catch(() => {})
    }

    // Check PR status
    if (repoName && currentProject?.path) {
      window.api.git.getProjectInfo(currentProject.path).then(({ branch }) => {
        if (!branch || branch === 'main' || branch === 'master') {
          setPrInfo(null)
          return
        }
        setLoadingPr(true)
        window.api.oauth.github.prStatus(repoName, branch).then((result) => {
          if ('hasPR' in result && result.hasPR) {
            setPrInfo({ number: result.number, url: result.url, title: result.title })
          } else {
            setPrInfo(null)
          }
          setLoadingPr(false)
        })
      })
    }
  }, [dropdownOpen, status.github, repoName, currentProject?.path])

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

  // Supabase auth view resize
  useEffect(() => {
    if (connecting !== 'supabase') return
    const onResize = () => {
      const bounds = getCanvasBounds()
      if (bounds) window.api.oauth.supabase.updateBounds(bounds)
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

  // ─── Supabase connect flow ─────────────────────────────────
  const connectSupabase = useCallback(async () => {
    setDropdownOpen(null)
    setConnecting('supabase')

    useWorkspaceStore.getState().openCanvas()
    await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => requestAnimationFrame(r))

    const bounds = getCanvasBounds()
    if (!bounds) {
      setConnecting(null)
      useToastStore.getState().addToast('Open the canvas panel first', 'error')
      return
    }

    const result = (await window.api.oauth.supabase.start({ bounds })) as
      | { token: string }
      | { error: string }

    setConnecting(null)

    if ('token' in result) {
      setStatus((prev) => ({ ...prev, supabase: true }))
      const statusData = (await window.api.oauth.supabase.status()) as {
        connected: boolean; name?: string; email?: string; avatar_url?: string | null
      }
      if (statusData.name) {
        setSupabaseUser({ name: statusData.name, email: statusData.email || '', avatar_url: statusData.avatar_url || null })
      }
      useToastStore.getState().addToast('Connected to Supabase!', 'success')
    } else if (result.error !== 'Cancelled') {
      useToastStore.getState().addToast(`Supabase: ${result.error}`, 'error')
    }
  }, [])

  const handleCancelSupabase = useCallback(() => {
    setConnecting(null)
    window.api.oauth.supabase.cancel()
  }, [])

  // Fetch linked Vercel project for current workspace
  const fetchLinkedProject = useCallback(async () => {
    if (!currentProject?.path || !status.vercel) return
    setLoadingLinkedProject(true)
    try {
      const result = await window.api.oauth.vercel.linkedProject({
        projectPath: currentProject.path,
        gitRepo: repoName || undefined
      })
      if ('linked' in result && result.linked) {
        setLinkedProject(result)
      } else {
        setLinkedProject(null)
        // Auto-load all projects when no linked project found
        setLoadingVercelProjects(true)
        const projects = await window.api.oauth.vercel.listProjects()
        setLoadingVercelProjects(false)
        if (Array.isArray(projects)) {
          setVercelProjects(projects)
          setShowVercelProjects(true)
        } else if (projects && 'error' in projects) {
          console.error('[Vercel] listProjects error:', projects.error)
          // Still show empty list (not stuck on loading)
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
    if (dropdownOpen !== 'vercel') return
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

  // Fetch build logs for a deployment
  const fetchBuildLogs = useCallback(async (deploymentId: string) => {
    setShowBuildLogs(true)
    setLoadingBuildLogs(true)
    try {
      const result = await window.api.oauth.vercel.buildLogs(deploymentId)
      if (Array.isArray(result)) {
        setBuildLogs(result)
      } else {
        useToastStore.getState().addToast(`Failed: ${result.error}`, 'error')
      }
    } catch {
      useToastStore.getState().addToast('Failed to fetch build logs', 'error')
    } finally {
      setLoadingBuildLogs(false)
    }
  }, [])

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
        setShowImportOptions(false)
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
    setLoadingSupabaseProject(true)

    const projects = await window.api.oauth.supabase.listProjects()
    if ('error' in projects) {
      setLoadingSupabaseProject(false)
      return
    }

    // Match by folder name
    const folderName = currentProject.path.split('/').pop()?.toLowerCase()
    const linked = (projects as SupabaseProject[]).find((p) => p.name.toLowerCase() === folderName)

    if (linked) {
      setLinkedSupabaseProject(linked)
      // Fetch all project data in parallel
      const [tables, fns, buckets, policies, connInfo] = await Promise.all([
        window.api.oauth.supabase.listTables(linked.ref),
        window.api.oauth.supabase.listFunctions(linked.ref),
        window.api.oauth.supabase.listBuckets(linked.ref),
        window.api.oauth.supabase.listPolicies(linked.ref),
        window.api.oauth.supabase.getConnectionInfo(linked.ref)
      ])
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

  // Refresh Supabase data when dropdown opens
  useEffect(() => {
    if (dropdownOpen !== 'supabase' || !status.supabase) return
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
    if (key === 'github') {
      setGithubUser(null)
      setRepoName(null)
    }
    if (key === 'vercel') {
      setVercelUser(null)
      setVercelProjects([])
      setLinkedProject(null)
    }
    if (key === 'supabase') {
      setSupabaseUser(null)
      setLinkedSupabaseProject(null)
      setSupabaseTables([])
      setSupabaseFunctions([])
      setSupabaseBuckets([])
      setSupabasePolicies([])
      setSupabaseConnectionInfo(null)
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
            className="relative p-1.5 rounded hover:bg-white/10 transition-colors"
            title={`GitHub: ${status.github ? 'Connected' : 'Not connected'}`}
          >
            {connecting === 'github' && !codeData ? (
              <Loader2 size={13} className="text-[var(--accent-cyan)] animate-spin" />
            ) : (
              <Github size={13} className="text-white/40" />
            )}
            <Circle
              size={5}
              className={`absolute -top-0 -right-0 ${
                status.github
                  ? 'fill-green-400 text-green-400'
                  : 'fill-white/20 text-white/20'
              }`}
            />
          </button>

          {/* Inline labels: username / repo */}
          {status.github && githubUser && (
            <button
              onClick={() => setDropdownOpen(dropdownOpen === 'github' ? null : 'github')}
              className="flex items-center gap-1 ml-0.5 px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
            >
              <span className="text-[11px] text-white/45">{githubUser.login}</span>
              {repoShort && (
                <>
                  <span className="text-[11px] text-white/20">/</span>
                  <span className="text-[11px] text-white/55 max-w-[100px] truncate">{repoShort}</span>
                </>
              )}
            </button>
          )}

          <AnimatePresence>
            {dropdownOpen === 'github' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full right-0 mt-1 w-72 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[100] overflow-hidden"
              >
                {/* Header */}
                {githubUser && status.github ? (
                  <div className="px-3 py-2.5 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      {githubUser.avatar_url && (
                        <img
                          src={`${githubUser.avatar_url}&s=32`}
                          alt=""
                          className="w-4 h-4 rounded-full shrink-0"
                        />
                      )}
                      <span className="text-xs font-medium text-white/80 truncate">
                        {githubUser.login}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 border-b border-white/10">
                    <span className="text-xs text-white/60">GitHub</span>
                  </div>
                )}

                {/* Contextual primary action */}
                {status.github && repoName && (
                  <div className="px-3 py-2.5 border-b border-white/10">
                    {gitAhead > 0 ? (
                      <button
                        onClick={() => {
                          setDropdownOpen(null)
                          document.querySelector<HTMLButtonElement>('[data-push-button]')?.click()
                        }}
                        className="w-full flex flex-col items-center gap-1 py-2.5 bg-[var(--accent-cyan)]/10 hover:bg-[var(--accent-cyan)]/15 border border-[var(--accent-cyan)]/20 rounded-lg transition-colors"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-cyan)]">
                          <ArrowUp size={12} />
                          Push {gitAhead} commit{gitAhead !== 1 ? 's' : ''}
                        </span>
                        {lastPushTime && (
                          <span className="text-[10px] text-white/25">Last pushed {timeAgo(lastPushTime)}</span>
                        )}
                      </button>
                    ) : gitBehind > 0 ? (
                      <button
                        onClick={() => {
                          setDropdownOpen(null)
                          document.querySelector<HTMLButtonElement>('[data-pull-button]')?.click()
                        }}
                        className="w-full flex flex-col items-center gap-1 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/20 rounded-lg transition-colors"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-400">
                          <ArrowDown size={12} />
                          Pull {gitBehind} commit{gitBehind !== 1 ? 's' : ''}
                        </span>
                        {lastFetchTime && (
                          <span className="text-[10px] text-white/25">Last fetched {timeAgo(lastFetchTime)}</span>
                        )}
                      </button>
                    ) : (
                      <div className="w-full flex flex-col items-center gap-1 py-2.5 bg-white/[0.03] border border-white/5 rounded-lg">
                        <span className="flex items-center gap-1.5 text-xs text-white/30">
                          <Check size={12} />
                          Up to date
                        </span>
                        {lastPushTime && (
                          <span className="text-[10px] text-white/20">Last pushed {timeAgo(lastPushTime)}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Quick actions */}
                {repoName && (
                  <div className="border-b border-white/10">
                    {/* PR action — contextual */}
                    {prInfo ? (
                      <button
                        onClick={() => window.open(prInfo.url, '_blank')}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
                      >
                        <GitPullRequest size={11} className="shrink-0 text-green-400" />
                        <span className="truncate flex-1">PR #{prInfo.number}</span>
                        <ExternalLink size={9} className="shrink-0 text-white/20" />
                      </button>
                    ) : gitAhead > 0 && currentBranch && currentBranch !== 'main' && currentBranch !== 'master' ? (
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
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/5 transition"
                      >
                        <Plus size={11} className="shrink-0" />
                        Create Pull Request
                      </button>
                    ) : null}

                    {/* Open on GitHub */}
                    <button
                      onClick={() => window.open(`https://github.com/${repoName}`, '_blank')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
                    >
                      <ExternalLink size={11} className="shrink-0" />
                      <span className="flex-1">Open on GitHub</span>
                      <kbd className="text-[9px] text-white/15 font-mono">⌘⇧G</kbd>
                    </button>

                    {/* View Issues */}
                    <button
                      onClick={() => window.open(`https://github.com/${repoName}/issues`, '_blank')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
                    >
                      <Circle size={11} className="shrink-0" />
                      View Issues
                    </button>
                  </div>
                )}

                {/* Repo info or link/create repo */}
                {status.github && (
                  <>
                    {repoName ? (
                      <div className="px-3 py-2 border-b border-white/10">
                        <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                          Repository
                        </div>
                        <div className="text-xs text-white/60 truncate">{repoName}</div>
                      </div>
                    ) : showLinkRepo ? (
                      <div className="border-b border-white/10">
                        <div className="px-3 pt-2 pb-1">
                          <input
                            autoFocus
                            value={repoSearchQuery}
                            onChange={(e) => setRepoSearchQuery(e.target.value)}
                            placeholder="Search repos..."
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-cyan)]/40"
                          />
                        </div>
                        <div className="max-h-[200px] overflow-y-auto">
                          {loadingRepos ? (
                            <div className="flex items-center justify-center py-3">
                              <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
                            </div>
                          ) : filteredRepos.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-white/30">No repos found</div>
                          ) : (
                            filteredRepos.slice(0, 20).map((repo) => (
                              <button
                                key={repo.full_name}
                                onClick={() => linkRepo(repo)}
                                disabled={creatingRepo}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-white/70 hover:bg-white/5 transition disabled:opacity-50"
                              >
                                <span className="truncate flex-1 min-w-0">{repo.full_name}</span>
                                {repo.private && (
                                  <span className="shrink-0 text-[9px] text-white/25">private</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                        <button
                          onClick={() => { setShowLinkRepo(false); setRepoSearchQuery('') }}
                          className="w-full px-3 py-1.5 text-[10px] text-white/30 hover:text-white/50 transition border-t border-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : showRepoInput ? (
                      <div className="px-3 py-2 border-b border-white/10">
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
                            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-cyan)]/40"
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
                      <div className="border-b border-white/10">
                        <button
                          onClick={openLinkRepo}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/60 hover:bg-white/5 hover:text-white/80 transition"
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
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/5 transition"
                        >
                          <Plus size={11} className="shrink-0" />
                          Create New Repo
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Branches */}
                {repoName && currentBranch && (
                  <div className="border-b border-white/10">
                    <div className="px-3 pt-2 pb-1">
                      <div className="text-[10px] uppercase tracking-wider text-white/30">Branches</div>
                    </div>
                    <div className="px-1 pb-1.5">
                      {/* Current branch */}
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-white/60">
                        <GitBranch size={10} className="shrink-0 text-[var(--accent-cyan)]" />
                        <span className="truncate flex-1">{currentBranch}</span>
                        <span className="text-[9px] text-white/20">current</span>
                      </div>
                      {/* Other branches (max 5) */}
                      {localBranches.slice(0, 5).map((branch) => (
                        <button
                          key={branch}
                          onClick={async () => {
                            if (!currentProject?.path) return
                            setDropdownOpen(null)
                            const targetDir = `${currentProject.path}/../${currentProject.name}-${branch}`
                            try {
                              const result = await window.api.worktree.checkout({
                                projectPath: currentProject.path,
                                branchName: branch,
                                targetDir
                              })
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
                          className="w-full flex items-center gap-2 px-2 py-1 text-xs text-left text-white/45 hover:bg-white/5 hover:text-white/70 rounded transition"
                        >
                          <GitBranch size={10} className="shrink-0" />
                          <span className="truncate flex-1">{branch}</span>
                        </button>
                      ))}
                      {localBranches.length > 5 && (
                        <div className="px-2 py-1 text-[10px] text-white/20">
                          +{localBranches.length - 5} more
                        </div>
                      )}
                    </div>
                    {/* Change repo link */}
                    <button
                      onClick={() => openLinkRepo()}
                      className="w-full px-3 py-1.5 text-[10px] text-white/25 hover:text-white/45 transition border-t border-white/5"
                    >
                      Change repo...
                    </button>
                  </div>
                )}

                {/* Connect / Disconnect */}
                {status.github ? (
                  <button
                    onClick={() => disconnectService('github')}
                    className="w-full px-3 py-2 text-xs text-left text-white/30 hover:bg-white/5 hover:text-white/50 transition"
                  >
                    Disconnect
                  </button>
                ) : (
                  <div className="p-4 text-center">
                    <Github size={24} className="mx-auto mb-2.5 text-white/20" />
                    <p className="text-xs text-white/40 mb-3 leading-relaxed">
                      Push code, create PRs, and<br />collaborate with your team.
                    </p>
                    <button
                      onClick={() => connectService('github')}
                      className="w-full py-2 text-xs font-medium text-white bg-[#238636] hover:bg-[#2ea043] rounded-lg transition-colors"
                    >
                      Connect to GitHub
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── Vercel ─── */}
        <div className="relative flex items-center" data-service-dropdown>
          <button
            onClick={() => setDropdownOpen(dropdownOpen === 'vercel' ? null : 'vercel')}
            className="relative p-1.5 rounded hover:bg-white/10 transition-colors"
            title={`Vercel: ${status.vercel ? 'Connected' : 'Not connected'}`}
          >
            {connecting === 'vercel' ? (
              <Loader2 size={13} className="text-[var(--accent-cyan)] animate-spin" />
            ) : (
              <Triangle size={13} className="text-white/40" />
            )}
            <Circle
              size={5}
              className={`absolute -top-0 -right-0 ${
                status.vercel
                  ? 'fill-green-400 text-green-400'
                  : 'fill-white/20 text-white/20'
              }`}
            />
          </button>

          {/* Inline label: username / project */}
          {status.vercel && vercelUser && (
            <button
              onClick={() => setDropdownOpen(dropdownOpen === 'vercel' ? null : 'vercel')}
              className="flex items-center gap-1 ml-0.5 px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
            >
              <span className="text-[11px] text-white/45">{vercelUser.username}</span>
              {linkedProject && (
                <>
                  <span className="text-[11px] text-white/20">/</span>
                  <span className="text-[11px] text-white/55 max-w-[100px] truncate">
                    {linkedProject.project.name}
                  </span>
                </>
              )}
            </button>
          )}

          <AnimatePresence>
            {dropdownOpen === 'vercel' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full right-0 mt-1 w-80 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[100] overflow-hidden"
              >
                {/* Header */}
                {vercelUser && status.vercel ? (
                  <div className="px-3 py-2.5 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      {vercelUser.avatar ? (
                        <img
                          src={vercelUser.avatar}
                          alt=""
                          className="w-5 h-5 rounded-full shrink-0"
                        />
                      ) : (
                        <Triangle size={12} className="text-white/40 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-white/80 truncate block">
                          {vercelUser.name || vercelUser.username}
                        </span>
                        {vercelUser.name && (
                          <span className="text-[10px] text-white/30 truncate block">
                            @{vercelUser.username}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 border-b border-white/10">
                    <span className="text-xs text-white/60">Vercel</span>
                  </div>
                )}

                {/* Linked project info */}
                {status.vercel && (
                  <>
                    {loadingLinkedProject ? (
                      <div className="flex items-center justify-center py-4 border-b border-white/10">
                        <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
                      </div>
                    ) : linkedProject ? (
                      <>
                        {/* Project section */}
                        <div className="px-3 py-2.5 border-b border-white/10">
                          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                            Project
                          </div>
                          <div className="flex items-center gap-2">
                            <Triangle size={10} className="shrink-0 text-white/50" />
                            <span className="text-xs font-medium text-white/80 truncate flex-1">
                              {linkedProject.project.name}
                            </span>
                            {linkedProject.project.framework && (
                              <span className="text-[10px] text-white/25 shrink-0">
                                {linkedProject.project.framework}
                              </span>
                            )}
                          </div>
                          <a
                            href={linkedProject.project.productionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--accent-cyan)]/70 hover:text-[var(--accent-cyan)] transition-colors"
                          >
                            <Globe size={9} className="shrink-0" />
                            <span className="truncate">
                              {linkedProject.project.productionUrl.replace('https://', '')}
                            </span>
                            <ExternalLink size={8} className="shrink-0 opacity-50" />
                          </a>
                        </div>

                        {/* Latest deployment */}
                        {linkedProject.latestDeployment && (
                          <div className="px-3 py-2.5 border-b border-white/10">
                            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                              Latest Deploy
                            </div>
                            <div className="flex items-center gap-2">
                              <Circle
                                size={6}
                                className={`shrink-0 ${deployStateColor(linkedProject.latestDeployment.state)}`}
                              />
                              <span className={`text-xs font-medium ${deployStateColor(linkedProject.latestDeployment.state).split(' ')[0]}`}>
                                {deployStateLabel(linkedProject.latestDeployment.state)}
                              </span>
                              <span className="text-[10px] text-white/25 ml-auto shrink-0">
                                {timeAgo(linkedProject.latestDeployment.created)}
                              </span>
                            </div>
                            {linkedProject.latestDeployment.commitMessage && (
                              <div className="text-[11px] text-white/40 mt-1 truncate">
                                &quot;{linkedProject.latestDeployment.commitMessage}&quot;
                              </div>
                            )}
                            <a
                              href={linkedProject.latestDeployment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 mt-1.5 text-[10px] text-white/35 hover:text-white/60 transition-colors"
                            >
                              <ExternalLink size={8} className="shrink-0" />
                              <span className="truncate">
                                {linkedProject.latestDeployment.url.replace('https://', '')}
                              </span>
                            </a>

                            {/* Build logs toggle */}
                            <button
                              onClick={() => {
                                if (showBuildLogs) {
                                  setShowBuildLogs(false)
                                } else if (linkedProject.latestDeployment) {
                                  fetchBuildLogs(linkedProject.latestDeployment.id)
                                }
                              }}
                              className="flex items-center gap-1.5 mt-2 text-[11px] text-white/40 hover:text-white/60 transition-colors"
                            >
                              {showBuildLogs ? (
                                <ChevronDown size={10} className="shrink-0" />
                              ) : (
                                <ChevronRight size={10} className="shrink-0" />
                              )}
                              <FileText size={10} className="shrink-0" />
                              Build Logs
                              {loadingBuildLogs && (
                                <Loader2 size={10} className="animate-spin text-[var(--accent-cyan)]" />
                              )}
                            </button>

                            {/* Build logs content */}
                            {showBuildLogs && buildLogs.length > 0 && (
                              <div className="mt-2 max-h-[160px] overflow-y-auto bg-black/40 rounded-md p-2 scrollbar-thin scrollbar-thumb-white/10">
                                {buildLogs.map((log, i) => (
                                  <div
                                    key={i}
                                    className="text-[10px] font-mono text-white/45 leading-4 whitespace-pre-wrap break-all"
                                  >
                                    {log.text}
                                  </div>
                                ))}
                              </div>
                            )}
                            {showBuildLogs && !loadingBuildLogs && buildLogs.length === 0 && (
                              <div className="mt-2 text-[10px] text-white/25 italic">
                                No build logs available
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      /* No linked project — show all projects */
                      <div className="border-b border-white/10">
                        {/* Import option at top */}
                        {repoName && (
                          <button
                            onClick={importToVercel}
                            disabled={importingProject}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/5 transition border-b border-white/5 disabled:opacity-50"
                          >
                            {importingProject ? (
                              <Loader2 size={11} className="shrink-0 animate-spin" />
                            ) : (
                              <Rocket size={11} className="shrink-0" />
                            )}
                            Import {repoName.split('/').pop()} to Vercel
                          </button>
                        )}

                        {/* Projects list */}
                        <div className="px-3 pt-2 pb-1">
                          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                            Your Projects
                          </div>
                          {vercelProjects.length > 3 && (
                            <input
                              value={vercelProjectSearch}
                              onChange={(e) => setVercelProjectSearch(e.target.value)}
                              placeholder="Search..."
                              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-cyan)]/40 mb-1"
                            />
                          )}
                        </div>
                        <div className="max-h-[200px] overflow-y-auto px-1 pb-2">
                          {loadingVercelProjects ? (
                            <div className="flex items-center justify-center py-3">
                              <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
                            </div>
                          ) : filteredVercelProjects.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-white/30">
                              {vercelProjectSearch ? 'No matching projects' : 'No projects yet'}
                            </div>
                          ) : (
                            filteredVercelProjects.slice(0, 20).map((project) => (
                              <div
                                key={project.id}
                                className="flex items-center gap-2 py-1.5 px-2 text-xs text-white/70 hover:bg-white/5 rounded transition"
                              >
                                <Triangle size={9} className="shrink-0 text-white/30" />
                                <span className="truncate flex-1 min-w-0">{project.name}</span>
                                {project.framework && (
                                  <span className="shrink-0 text-[9px] text-white/25">
                                    {project.framework}
                                  </span>
                                )}
                                {project.url && (
                                  <a
                                    href={project.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 p-0.5 text-white/30 hover:text-[var(--accent-cyan)] transition-colors"
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
                    )}
                  </>
                )}

                {/* Connect / Disconnect */}
                {status.vercel ? (
                  <button
                    onClick={() => disconnectService('vercel')}
                    className="w-full px-3 py-2 text-xs text-left text-white/30 hover:bg-white/5 hover:text-white/50 transition"
                  >
                    Disconnect
                  </button>
                ) : (
                  <div className="p-4 text-center">
                    <Triangle size={24} className="mx-auto mb-2.5 text-white/20" />
                    <p className="text-xs text-white/40 mb-3 leading-relaxed">
                      Deploy your app and get a<br />live URL in seconds.
                    </p>
                    <button
                      onClick={() => connectService('vercel')}
                      className="w-full py-2 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-colors"
                    >
                      Connect to Vercel
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── Supabase ─── */}
        <div className="relative flex items-center" data-service-dropdown>
          <button
            onClick={() => setDropdownOpen(dropdownOpen === 'supabase' ? null : 'supabase')}
            className="relative p-1.5 rounded hover:bg-white/10 transition-colors"
            title={`Supabase: ${status.supabase ? 'Connected' : 'Not connected'}`}
          >
            {connecting === 'supabase' ? (
              <Loader2 size={13} className="text-[var(--accent-cyan)] animate-spin" />
            ) : (
              <Database size={13} className="text-white/40" />
            )}
            <Circle
              size={5}
              className={`absolute -top-0 -right-0 ${
                status.supabase
                  ? 'fill-green-400 text-green-400'
                  : 'fill-white/20 text-white/20'
              }`}
            />
          </button>

          {/* Inline label */}
          {status.supabase && supabaseUser && (
            <button
              onClick={() => setDropdownOpen(dropdownOpen === 'supabase' ? null : 'supabase')}
              className="flex items-center gap-1 ml-0.5 px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
            >
              <span className="text-[11px] text-white/45 max-w-[80px] truncate">{supabaseUser.email}</span>
              {linkedSupabaseProject && (
                <>
                  <span className="text-[11px] text-white/20">/</span>
                  <span className="text-[11px] text-white/55 max-w-[100px] truncate">
                    {linkedSupabaseProject.name}
                  </span>
                </>
              )}
            </button>
          )}

          <AnimatePresence>
            {dropdownOpen === 'supabase' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full right-0 mt-1 w-80 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[100] overflow-hidden max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10"
              >
                {/* Header */}
                {supabaseUser && status.supabase ? (
                  <div className="px-3 py-2.5 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      {supabaseUser.avatar_url ? (
                        <img src={supabaseUser.avatar_url} alt="" className="w-5 h-5 rounded-full shrink-0" />
                      ) : (
                        <Database size={12} className="text-white/40 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-white/80 truncate block">
                          {supabaseUser.name}
                        </span>
                        <span className="text-[10px] text-white/30 truncate block">
                          {supabaseUser.email}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 border-b border-white/10">
                    <span className="text-xs text-white/60">Supabase</span>
                  </div>
                )}

                {/* Content when connected */}
                {status.supabase && (
                  <>
                    {loadingSupabaseProject ? (
                      <div className="flex items-center justify-center py-4 border-b border-white/10">
                        <Loader2 size={14} className="text-[var(--accent-cyan)] animate-spin" />
                      </div>
                    ) : linkedSupabaseProject ? (
                      <>
                        {/* Linked project */}
                        <div className="px-3 py-2.5 border-b border-white/10">
                          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                            Project
                          </div>
                          <div className="flex items-center gap-2">
                            <Database size={10} className="shrink-0 text-white/50" />
                            <span className="text-xs font-medium text-white/80 truncate flex-1">
                              {linkedSupabaseProject.name}
                            </span>
                            <Circle
                              size={6}
                              className={`shrink-0 ${
                                linkedSupabaseProject.status === 'ACTIVE_HEALTHY'
                                  ? 'fill-green-400 text-green-400'
                                  : linkedSupabaseProject.status === 'INACTIVE'
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'fill-white/30 text-white/30'
                              }`}
                            />
                          </div>
                          <div className="text-[10px] text-white/25 mt-0.5">
                            {linkedSupabaseProject.region}
                          </div>

                          {/* Connection URL with copy */}
                          {supabaseConnectionInfo && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(supabaseConnectionInfo.url)
                                setCopiedSupabaseUrl(true)
                                setTimeout(() => setCopiedSupabaseUrl(false), 2000)
                              }}
                              className="flex items-center gap-1.5 mt-2 w-full text-left group"
                            >
                              <span className="text-[10px] text-[var(--accent-cyan)]/60 group-hover:text-[var(--accent-cyan)] truncate flex-1 font-mono">
                                {supabaseConnectionInfo.url.replace('https://', '')}
                              </span>
                              {copiedSupabaseUrl ? (
                                <Check size={9} className="shrink-0 text-green-400" />
                              ) : (
                                <Copy size={9} className="shrink-0 text-white/20 group-hover:text-white/50" />
                              )}
                            </button>
                          )}
                        </div>

                        {/* Tables section */}
                        <div className="border-b border-white/10">
                          <button
                            onClick={() => setShowSupabaseTables(!showSupabaseTables)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/50 hover:text-white/70 hover:bg-white/5 transition"
                          >
                            {showSupabaseTables ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>Tables</span>
                            <span className="text-[10px] text-white/25 ml-auto">{supabaseTables.length}</span>
                          </button>
                          {showSupabaseTables && supabaseTables.length > 0 && (
                            <div className="px-3 pb-2 max-h-[150px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                              {supabaseTables.map((t) => (
                                <div key={`${t.schema}.${t.name}`} className="flex items-center gap-2 py-1 text-[11px]">
                                  <span className="text-white/25 shrink-0">{t.schema}.</span>
                                  <span className="text-white/60 truncate flex-1">{t.name}</span>
                                  <span className="text-[9px] text-white/20 shrink-0">{t.columns.length} cols</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Edge Functions section */}
                        <div className="border-b border-white/10">
                          <button
                            onClick={() => setShowSupabaseFunctions(!showSupabaseFunctions)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/50 hover:text-white/70 hover:bg-white/5 transition"
                          >
                            {showSupabaseFunctions ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>Edge Functions</span>
                            <span className="text-[10px] text-white/25 ml-auto">{supabaseFunctions.length}</span>
                          </button>
                          {showSupabaseFunctions && supabaseFunctions.length > 0 && (
                            <div className="px-3 pb-2 max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                              {supabaseFunctions.map((f) => (
                                <div key={f.id} className="flex items-center gap-2 py-1 text-[11px]">
                                  <span className="text-white/60 truncate flex-1">{f.name}</span>
                                  <span className={`text-[9px] shrink-0 ${f.status === 'ACTIVE' ? 'text-green-400/60' : 'text-white/20'}`}>
                                    {f.status?.toLowerCase()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Storage Buckets section */}
                        <div className="border-b border-white/10">
                          <button
                            onClick={() => setShowSupabaseBuckets(!showSupabaseBuckets)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/50 hover:text-white/70 hover:bg-white/5 transition"
                          >
                            {showSupabaseBuckets ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>Storage Buckets</span>
                            <span className="text-[10px] text-white/25 ml-auto">{supabaseBuckets.length}</span>
                          </button>
                          {showSupabaseBuckets && supabaseBuckets.length > 0 && (
                            <div className="px-3 pb-2 max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                              {supabaseBuckets.map((b) => (
                                <div key={b.id} className="flex items-center gap-2 py-1 text-[11px]">
                                  <span className="text-white/60 truncate flex-1">{b.name}</span>
                                  <span className={`text-[9px] shrink-0 px-1.5 py-0.5 rounded-full ${b.public ? 'bg-amber-500/10 text-amber-400/60' : 'bg-white/5 text-white/25'}`}>
                                    {b.public ? 'public' : 'private'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* RLS Policies section */}
                        <div className="border-b border-white/10">
                          <button
                            onClick={() => setShowSupabasePolicies(!showSupabasePolicies)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/50 hover:text-white/70 hover:bg-white/5 transition"
                          >
                            {showSupabasePolicies ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span>RLS Policies</span>
                            <span className="text-[10px] text-white/25 ml-auto">{supabasePolicies.length}</span>
                          </button>
                          {showSupabasePolicies && supabasePolicies.length > 0 && (
                            <div className="px-3 pb-2 max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                              {supabasePolicies.map((p, i) => (
                                <div key={i} className="flex items-center gap-2 py-1 text-[11px]">
                                  <span className="text-white/25 shrink-0">{p.table}</span>
                                  <span className="text-white/50 truncate flex-1">{p.name}</span>
                                  <span className="text-[9px] text-white/20 shrink-0">{p.command}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Open Dashboard */}
                        <button
                          onClick={() => window.open(`https://supabase.com/dashboard/project/${linkedSupabaseProject.ref}`, '_blank')}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-white/50 hover:text-white/70 hover:bg-white/5 transition border-b border-white/10"
                        >
                          <ExternalLink size={10} className="shrink-0" />
                          Open Dashboard
                        </button>
                      </>
                    ) : showSupabaseProjectPicker ? (
                      /* Project picker */
                      <div className="border-b border-white/10">
                        <div className="px-3 pt-2 pb-1">
                          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                            Select Project
                          </div>
                          {supabaseProjects.length > 3 && (
                            <input
                              value={supabaseProjectSearch}
                              onChange={(e) => setSupabaseProjectSearch(e.target.value)}
                              placeholder="Search..."
                              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-cyan)]/40 mb-1"
                            />
                          )}
                        </div>
                        <div className="max-h-[200px] overflow-y-auto px-1 pb-2">
                          {filteredSupabaseProjects.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-white/30">
                              {supabaseProjectSearch ? 'No matching projects' : 'No projects'}
                            </div>
                          ) : (
                            filteredSupabaseProjects.map((project) => (
                              <button
                                key={project.id}
                                onClick={() => selectSupabaseProject(project)}
                                className="w-full flex items-center gap-2 py-1.5 px-2 text-xs text-left text-white/70 hover:bg-white/5 rounded transition"
                              >
                                <Database size={9} className="shrink-0 text-white/30" />
                                <span className="truncate flex-1">{project.name}</span>
                                <span className="shrink-0 text-[9px] text-white/25">{project.region}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                {/* Connect / Disconnect */}
                {status.supabase ? (
                  <button
                    onClick={() => disconnectService('supabase')}
                    className="w-full px-3 py-2 text-xs text-left text-white/40 hover:bg-white/5 hover:text-white/60 transition"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => connectService('supabase')}
                    className="w-full px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/5 transition"
                  >
                    Connect
                  </button>
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
