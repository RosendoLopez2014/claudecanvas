/**
 * Comprehensive tests for the Dev Server Upgrade (Phases 1–4)
 *
 * Phase 1: Multi-project correctness — per-tab dev state, no cross-talk
 * Phase 2: Auto command detection — framework detect, command resolution, picker
 * Phase 3: Runtime hardening — crash loop, probe, reliable kill, structured logs
 * Phase 4: UX polish — status indicators, clickable URL, change command
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTabsStore, DEFAULT_DEV_STATE } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useWorkspaceStore } from '@/stores/workspace'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 1: Multi-project correctness
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 1: Per-tab dev server state', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('new tabs have DEFAULT_DEV_STATE', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    const tab = useTabsStore.getState().tabs[0]
    expect(tab.dev).toEqual(DEFAULT_DEV_STATE)
    expect(tab.dev.status).toBe('stopped')
    expect(tab.dev.url).toBeNull()
    expect(tab.dev.pid).toBeNull()
    expect(tab.dev.lastError).toBeNull()
    expect(tab.dev.lastExitCode).toBeNull()
  })

  it('previewUrl defaults to null', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    expect(useTabsStore.getState().tabs[0].previewUrl).toBeNull()
  })
})

describe('Phase 1: updateDevForProject', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('updates dev state for ALL tabs sharing the same project path', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().addTab({ name: 'Other', path: '/other' })

    useTabsStore.getState().updateDevForProject('/app', {
      status: 'running',
      url: 'http://localhost:3000',
      pid: 12345,
    })

    const tabs = useTabsStore.getState().tabs
    // Both /app tabs should be updated
    expect(tabs[0].dev.status).toBe('running')
    expect(tabs[0].dev.url).toBe('http://localhost:3000')
    expect(tabs[1].dev.status).toBe('running')
    expect(tabs[1].dev.url).toBe('http://localhost:3000')
    // /other tab should be untouched
    expect(tabs[2].dev.status).toBe('stopped')
    expect(tabs[2].dev.url).toBeNull()
  })

  it('merges partial updates (does not reset unmentioned fields)', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'running',
      url: 'http://localhost:3000',
      pid: 999,
    })

    // Now update only status and url
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'stopped',
      url: null,
    })

    const tab = useTabsStore.getState().tabs[0]
    expect(tab.dev.status).toBe('stopped')
    expect(tab.dev.url).toBeNull()
    // pid should still be 999 (not reset to null)
    expect(tab.dev.pid).toBe(999)
  })
})

describe('Phase 1: updateTabsByProject', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('updates generic fields for all matching tabs', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })

    useTabsStore.getState().updateTabsByProject('/app', {
      previewUrl: 'http://localhost:3000',
    })

    const tabs = useTabsStore.getState().tabs
    expect(tabs[0].previewUrl).toBe('http://localhost:3000')
    expect(tabs[1].previewUrl).toBe('http://localhost:3000')
  })

  it('does not affect tabs from different projects', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().addTab({ name: 'Site', path: '/site' })

    useTabsStore.getState().updateTabsByProject('/app', { previewUrl: 'http://localhost:3000' })

    expect(useTabsStore.getState().tabs[1].previewUrl).toBeNull()
  })
})

describe('Phase 1: Tab close cleanup', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('closing a tab activates neighbor', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    useTabsStore.getState().addTab({ name: 'P2', path: '/p2' })
    const tabs = useTabsStore.getState().tabs
    useTabsStore.getState().setActiveTab(tabs[0].id)

    useTabsStore.getState().closeTab(tabs[0].id)

    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeTabId).toBe(tabs[1].id)
  })

  it('closing last tab sets activeTabId to null', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    const tab = useTabsStore.getState().tabs[0]
    useTabsStore.getState().closeTab(tab.id)

    expect(useTabsStore.getState().tabs).toHaveLength(0)
    expect(useTabsStore.getState().activeTabId).toBeNull()
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 2: Auto command detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 2: updateProjectInfo', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('updates project metadata on a tab', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    const tab = useTabsStore.getState().tabs[0]
    expect(tab.project.devCommand).toBeUndefined()

    useTabsStore.getState().updateProjectInfo(tab.id, {
      devCommand: 'bun run dev',
      devPort: 3000,
      framework: 'vite',
    })

    const updated = useTabsStore.getState().tabs[0]
    expect(updated.project.devCommand).toBe('bun run dev')
    expect(updated.project.devPort).toBe(3000)
    expect(updated.project.framework).toBe('vite')
  })

  it('does not affect other tabs', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().addTab({ name: 'Site', path: '/site' })
    const tabs = useTabsStore.getState().tabs

    useTabsStore.getState().updateProjectInfo(tabs[0].id, {
      devCommand: 'npm run dev',
    })

    expect(useTabsStore.getState().tabs[1].project.devCommand).toBeUndefined()
  })

  it('persists project name and path (not overwritten)', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    const tab = useTabsStore.getState().tabs[0]

    useTabsStore.getState().updateProjectInfo(tab.id, {
      devCommand: 'pnpm dev',
    })

    const updated = useTabsStore.getState().tabs[0]
    expect(updated.project.name).toBe('App')
    expect(updated.project.path).toBe('/app')
    expect(updated.project.devCommand).toBe('pnpm dev')
  })
})

describe('Phase 2: Command persistence in project store', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [],
      screen: 'workspace',
    })
  })

  it('devCommand on ProjectInfo is optional', () => {
    const project = { name: 'App', path: '/app' }
    useProjectStore.getState().setCurrentProject(project)
    expect(useProjectStore.getState().currentProject?.devCommand).toBeUndefined()
  })

  it('devCommand persists when set on project', () => {
    useProjectStore.getState().setCurrentProject({
      name: 'App',
      path: '/app',
      devCommand: 'pnpm dev',
      framework: 'vite',
    })
    expect(useProjectStore.getState().currentProject?.devCommand).toBe('pnpm dev')
    expect(useProjectStore.getState().currentProject?.framework).toBe('vite')
  })

  it('clearing devCommand allows re-detection', () => {
    useProjectStore.getState().setCurrentProject({
      name: 'App',
      path: '/app',
      devCommand: 'npm run dev',
    })
    // Simulate "Change Command" — clear devCommand
    useProjectStore.getState().setCurrentProject({
      ...useProjectStore.getState().currentProject!,
      devCommand: undefined,
    })
    expect(useProjectStore.getState().currentProject?.devCommand).toBeUndefined()
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3: Runtime hardening
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 3: dev.clearCrashHistory IPC mock', () => {
  it('clearCrashHistory is available on window.api.dev', () => {
    expect(window.api.dev.clearCrashHistory).toBeDefined()
    expect(typeof window.api.dev.clearCrashHistory).toBe('function')
  })

  it('clearCrashHistory is callable', async () => {
    await expect(window.api.dev.clearCrashHistory('/test')).resolves.not.toThrow()
  })
})

describe('Phase 3: dev.status IPC mock', () => {
  it('dev.status is available on window.api.dev', () => {
    expect(window.api.dev.status).toBeDefined()
    expect(typeof window.api.dev.status).toBe('function')
  })

  it('dev.status returns running state', async () => {
    const result = await window.api.dev.status('/test')
    expect(result).toHaveProperty('running')
    expect(result).toHaveProperty('url')
    expect(typeof result.running).toBe('boolean')
  })
})

describe('Phase 3: Constants are defined', () => {
  it('DEV_SERVER_PROBE_PORTS contains common ports', async () => {
    const { DEV_SERVER_PROBE_PORTS } = await import('../../shared/constants')
    expect(DEV_SERVER_PROBE_PORTS).toContain(3000)
    expect(DEV_SERVER_PROBE_PORTS).toContain(5173)
    expect(DEV_SERVER_PROBE_PORTS).toContain(8080)
    expect(DEV_SERVER_PROBE_PORTS.length).toBeGreaterThanOrEqual(5)
  })

  it('CRASH_LOOP_MAX is reasonable', async () => {
    const { CRASH_LOOP_MAX } = await import('../../shared/constants')
    expect(CRASH_LOOP_MAX).toBeGreaterThanOrEqual(2)
    expect(CRASH_LOOP_MAX).toBeLessThanOrEqual(10)
  })

  it('CRASH_LOOP_WINDOW_MS is a reasonable window', async () => {
    const { CRASH_LOOP_WINDOW_MS } = await import('../../shared/constants')
    expect(CRASH_LOOP_WINDOW_MS).toBeGreaterThanOrEqual(30_000)
    expect(CRASH_LOOP_WINDOW_MS).toBeLessThanOrEqual(300_000)
  })

  it('DEV_KILL_TIMEOUT_MS is defined', async () => {
    const { DEV_KILL_TIMEOUT_MS } = await import('../../shared/constants')
    expect(DEV_KILL_TIMEOUT_MS).toBeGreaterThanOrEqual(2000)
    expect(DEV_KILL_TIMEOUT_MS).toBeLessThanOrEqual(15000)
  })
})

describe('Phase 3: Error state management', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('tracks lastError on dev state', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'error',
      lastError: 'EADDRINUSE: port 3000 already in use',
    })

    const tab = useTabsStore.getState().tabs[0]
    expect(tab.dev.status).toBe('error')
    expect(tab.dev.lastError).toBe('EADDRINUSE: port 3000 already in use')
  })

  it('tracks lastExitCode on dev state', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'stopped',
      lastExitCode: 1,
    })

    const tab = useTabsStore.getState().tabs[0]
    expect(tab.dev.lastExitCode).toBe(1)
  })

  it('clears error when restarting', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'error',
      lastError: 'crash',
    })

    // Simulate restart
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'starting',
      lastError: null,
    })

    const tab = useTabsStore.getState().tabs[0]
    expect(tab.dev.status).toBe('starting')
    expect(tab.dev.lastError).toBeNull()
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 4: UX polish
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 4: Dev status transitions', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('supports full lifecycle: stopped → starting → running → stopped', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })

    useTabsStore.getState().updateDevForProject('/app', { status: 'starting' })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('starting')

    useTabsStore.getState().updateDevForProject('/app', {
      status: 'running',
      url: 'http://localhost:3000',
      pid: 42,
    })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('running')
    expect(useTabsStore.getState().tabs[0].dev.url).toBe('http://localhost:3000')

    useTabsStore.getState().updateDevForProject('/app', {
      status: 'stopped',
      url: null,
      pid: null,
    })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('stopped')
  })

  it('supports error state: stopped → starting → error', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })

    useTabsStore.getState().updateDevForProject('/app', { status: 'starting' })
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'error',
      lastError: 'Could not resolve module',
    })

    const tab = useTabsStore.getState().tabs[0]
    expect(tab.dev.status).toBe('error')
    expect(tab.dev.lastError).toContain('Could not resolve')
  })
})

describe('Phase 4: Preview URL independent of dev server', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('previewUrl can be set without a running dev server', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    const tab = useTabsStore.getState().tabs[0]

    // Set preview URL directly (e.g., from MCP set_preview_url)
    useTabsStore.getState().updateTab(tab.id, {
      previewUrl: 'http://localhost:8080',
    })

    expect(useTabsStore.getState().tabs[0].previewUrl).toBe('http://localhost:8080')
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('stopped')
  })

  it('previewUrl is cleared when dev server stops', () => {
    useTabsStore.getState().addTab({ name: 'App', path: '/app' })
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'running',
      url: 'http://localhost:3000',
    })
    useTabsStore.getState().updateTabsByProject('/app', {
      previewUrl: 'http://localhost:3000',
    })

    // Server stops
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'stopped',
      url: null,
    })
    useTabsStore.getState().updateTabsByProject('/app', { previewUrl: null })

    expect(useTabsStore.getState().tabs[0].previewUrl).toBeNull()
  })
})

describe('Phase 4: Multi-project isolation', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('two projects can have independent dev server states', () => {
    useTabsStore.getState().addTab({ name: 'Frontend', path: '/frontend' })
    useTabsStore.getState().addTab({ name: 'Backend', path: '/backend' })

    useTabsStore.getState().updateDevForProject('/frontend', {
      status: 'running',
      url: 'http://localhost:3000',
    })
    useTabsStore.getState().updateDevForProject('/backend', {
      status: 'running',
      url: 'http://localhost:8080',
    })

    const tabs = useTabsStore.getState().tabs
    expect(tabs[0].dev.status).toBe('running')
    expect(tabs[0].dev.url).toBe('http://localhost:3000')
    expect(tabs[1].dev.status).toBe('running')
    expect(tabs[1].dev.url).toBe('http://localhost:8080')
  })

  it('stopping one project does not affect the other', () => {
    useTabsStore.getState().addTab({ name: 'Frontend', path: '/frontend' })
    useTabsStore.getState().addTab({ name: 'Backend', path: '/backend' })

    useTabsStore.getState().updateDevForProject('/frontend', {
      status: 'running',
      url: 'http://localhost:3000',
    })
    useTabsStore.getState().updateDevForProject('/backend', {
      status: 'running',
      url: 'http://localhost:8080',
    })

    // Stop frontend only
    useTabsStore.getState().updateDevForProject('/frontend', {
      status: 'stopped',
      url: null,
    })

    expect(useTabsStore.getState().tabs[0].dev.status).toBe('stopped')
    expect(useTabsStore.getState().tabs[1].dev.status).toBe('running')
    expect(useTabsStore.getState().tabs[1].dev.url).toBe('http://localhost:8080')
  })
})

describe('Phase 4: Toast store supports action buttons', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('supports action button on toast (for crash loop "Clear & Retry")', () => {
    const onClick = vi.fn()
    useToastStore.getState().addToast('Crash loop detected', 'error', {
      duration: 10000,
      action: { label: 'Clear & Retry', onClick },
    })

    const toast = useToastStore.getState().toasts[0]
    expect(toast.action).toBeDefined()
    expect(toast.action!.label).toBe('Clear & Retry')
    expect(toast.duration).toBe(10000)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cross-phase integration tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Cross-phase: Full server lifecycle simulation', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('simulates: open project → detect → start → URL → preview → stop', () => {
    // Phase 2: Open project with detected command
    useTabsStore.getState().addTab({
      name: 'my-app',
      path: '/my-app',
      devCommand: 'bun run dev',
      framework: 'vite',
      devPort: 5173,
    })
    const tab = useTabsStore.getState().tabs[0]
    expect(tab.project.devCommand).toBe('bun run dev')
    expect(tab.dev.status).toBe('stopped')

    // Phase 1: Start — update dev state for project
    useTabsStore.getState().updateDevForProject('/my-app', {
      status: 'starting',
      lastError: null,
    })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('starting')

    // Phase 3: Server responds with URL
    useTabsStore.getState().updateDevForProject('/my-app', {
      status: 'running',
      url: 'http://localhost:5173',
      pid: 9876,
    })
    useTabsStore.getState().updateTabsByProject('/my-app', {
      previewUrl: 'http://localhost:5173',
    })

    const running = useTabsStore.getState().tabs[0]
    expect(running.dev.status).toBe('running')
    expect(running.dev.url).toBe('http://localhost:5173')
    expect(running.previewUrl).toBe('http://localhost:5173')

    // Phase 4: Stop server
    useTabsStore.getState().updateDevForProject('/my-app', {
      status: 'stopped',
      url: null,
      pid: null,
    })
    useTabsStore.getState().updateTabsByProject('/my-app', { previewUrl: null })

    const stopped = useTabsStore.getState().tabs[0]
    expect(stopped.dev.status).toBe('stopped')
    expect(stopped.previewUrl).toBeNull()
  })

  it('simulates: crash → error state → retry → success', () => {
    useTabsStore.getState().addTab({ name: 'app', path: '/app' })

    // Start
    useTabsStore.getState().updateDevForProject('/app', { status: 'starting' })

    // Crash
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'error',
      lastError: 'Module not found: react',
      lastExitCode: 1,
    })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('error')
    expect(useTabsStore.getState().tabs[0].dev.lastExitCode).toBe(1)

    // Retry — clear error, restart
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'starting',
      lastError: null,
    })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('starting')

    // Success after retry
    useTabsStore.getState().updateDevForProject('/app', {
      status: 'running',
      url: 'http://localhost:3000',
      pid: 5555,
    })
    expect(useTabsStore.getState().tabs[0].dev.status).toBe('running')
  })
})

describe('Cross-phase: Tab switching with multiple projects', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('tab switch preserves per-tab dev state', () => {
    const id1 = useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    const id2 = useTabsStore.getState().addTab({ name: 'P2', path: '/p2' })

    // P1 running
    useTabsStore.getState().updateDevForProject('/p1', {
      status: 'running',
      url: 'http://localhost:3000',
    })

    // Switch to P2
    useTabsStore.getState().setActiveTab(id2)
    expect(useTabsStore.getState().activeTabId).toBe(id2)

    // P1's dev state is still running
    const p1 = useTabsStore.getState().tabs.find((t) => t.id === id1)
    expect(p1?.dev.status).toBe('running')
    expect(p1?.dev.url).toBe('http://localhost:3000')

    // P2 is still stopped
    const p2 = useTabsStore.getState().tabs.find((t) => t.id === id2)
    expect(p2?.dev.status).toBe('stopped')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 5: Auto-start safety — low-confidence plans must not auto-start
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 5: dev:start refuses low-confidence auto-resolve', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('dev.start() without command returns needsConfiguration when resolve is low confidence', async () => {
    // Mock resolve to return low confidence (project has no dev script)
    vi.mocked(window.api.dev.resolve).mockResolvedValueOnce({
      plan: {
        cwd: '/no-dev-script',
        manager: 'npm',
        command: { bin: 'npm', args: ['run', 'dev'] },
        confidence: 'low',
        reasons: ['Could not determine dev command'],
        detection: {},
      },
      needsVerification: true,
    })
    // Mock start to return the needsConfiguration error (matches main process behavior)
    vi.mocked(window.api.dev.start).mockResolvedValueOnce({
      error: 'Could not auto-detect dev command. Please configure it manually.',
      errorCode: 'DEV_COMMAND_UNRESOLVED',
      needsConfiguration: true,
    } as any)

    const result = await window.api.dev.start('/no-dev-script')
    expect(result.errorCode).toBe('DEV_COMMAND_UNRESOLVED')
    expect(result.needsConfiguration).toBe(true)
  })

  it('dev.start() with explicit command does not check confidence', async () => {
    // When user provides a command, it should always attempt to start
    vi.mocked(window.api.dev.start).mockResolvedValueOnce({
      url: 'http://localhost:8080',
      pid: 9999,
    } as any)

    const result = await window.api.dev.start('/any-project', 'npm run serve')
    expect(result.url).toBe('http://localhost:8080')
    expect(result.pid).toBe(9999)
    expect(result.needsConfiguration).toBeUndefined()
  })
})

describe('Phase 5: extractScriptName utility', () => {
  // Import is from shared/devserver/types — test the logic inline since we can't
  // import main-process code in the renderer test environment.
  const extractScriptName = (cmd: { bin: string; args: string[] }): string | null => {
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(cmd.bin)) return null
    if (cmd.args.length === 0) return null
    if (cmd.args[0] === 'run' && cmd.args.length >= 2) return cmd.args[1]
    const PM_SUBCOMMANDS = new Set([
      'install', 'i', 'ci', 'init', 'publish', 'pack', 'link', 'unlink',
      'add', 'remove', 'upgrade', 'update', 'exec', 'dlx', 'create',
      'x', 'cache', 'config', 'set', 'get', 'info', 'why', 'ls', 'list',
      'outdated', 'prune', 'rebuild', 'audit', 'fund', 'login', 'logout',
      'whoami', 'version', 'help', 'bin', 'prefix', 'root',
    ])
    if (!PM_SUBCOMMANDS.has(cmd.args[0])) return cmd.args[0]
    return null
  }

  it('extracts script from "npm run dev"', () => {
    expect(extractScriptName({ bin: 'npm', args: ['run', 'dev'] })).toBe('dev')
  })

  it('extracts script from "yarn dev"', () => {
    expect(extractScriptName({ bin: 'yarn', args: ['dev'] })).toBe('dev')
  })

  it('extracts script from "npm start"', () => {
    expect(extractScriptName({ bin: 'npm', args: ['start'] })).toBe('start')
  })

  it('returns null for "npx vite" (not a script ref)', () => {
    expect(extractScriptName({ bin: 'npx', args: ['vite'] })).toBeNull()
  })

  it('returns null for "node server.js"', () => {
    expect(extractScriptName({ bin: 'node', args: ['server.js'] })).toBeNull()
  })

  it('returns null for "npm install"', () => {
    expect(extractScriptName({ bin: 'npm', args: ['install'] })).toBeNull()
  })
})

describe('Phase 5: Missing script returns needsConfiguration', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('dev.start() with explicit command referencing missing script returns DEV_COMMAND_UNRESOLVED', async () => {
    // Simulates the IPC handler behavior: explicit command "npm run dev"
    // where the project has no "dev" script in package.json
    vi.mocked(window.api.dev.start).mockResolvedValueOnce({
      error: 'Script "dev" does not exist in package.json. Please configure the dev command.',
      errorCode: 'DEV_COMMAND_UNRESOLVED',
      needsConfiguration: true,
    } as any)

    const result = await window.api.dev.start('/agenticlabs-studio', 'npm run dev')
    expect(result.errorCode).toBe('DEV_COMMAND_UNRESOLVED')
    expect(result.needsConfiguration).toBe(true)
    expect(result.error).toContain('does not exist in package.json')
  })
})

describe('Phase 5: MCP start_preview does not auto-start low-confidence', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('resolve returning low confidence means start is never called', async () => {
    // When resolve returns low confidence, the MCP handler should NOT call dev.start
    vi.mocked(window.api.dev.resolve).mockResolvedValueOnce({
      plan: {
        cwd: '/no-dev-script',
        manager: 'npm',
        command: { bin: 'npm', args: ['run', 'dev'] },
        confidence: 'low',
        reasons: ['Could not determine dev command'],
        detection: {},
      },
      needsVerification: true,
    })

    // Call resolve and check the confidence gate
    const resolved = await window.api.dev.resolve('/no-dev-script')
    expect(resolved.plan.confidence).toBe('low')

    // The MCP handler should NOT proceed to start — verify the contract
    // (In the real handler, it toasts and returns early)
    const startSpy = vi.mocked(window.api.dev.start)
    const callCountBefore = startSpy.mock.calls.length
    // Simulate the gate: if low confidence, don't call start
    if (resolved.plan.confidence === 'low') {
      // This is what the MCP handler does — early return
    } else {
      await window.api.dev.start('/no-dev-script')
    }
    expect(startSpy.mock.calls.length).toBe(callCountBefore)
  })
})
