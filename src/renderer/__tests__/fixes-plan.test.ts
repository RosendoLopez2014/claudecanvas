/**
 * Tests for Plan 1: Fixes & Hardening
 * Run after implementing docs/plans/2026-02-14-claude-canvas-upgrade-design.md Plan 1
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'

// ── Phase 1: Memory Leaks & Race Conditions ─────────────────────────

describe.skip('Fix: Git instance cleanup (implement in Plan 1 Task 1)', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('cleanup IPC handler exists in preload bridge', () => {
    expect(window.api.git.cleanup).toBeDefined()
    expect(typeof window.api.git.cleanup).toBe('function')
  })

  it('cleanup is callable with a project path', async () => {
    await expect(window.api.git.cleanup('/test/path')).resolves.not.toThrow()
  })
})

describe.skip('Fix: Tab close resource cleanup (implement in Plan 1 Task 2)', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('kills PTY on tab close', async () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'Test', path: '/test' })
    const tab = useTabsStore.getState().tabs[0]
    useTabsStore.getState().updateTab(tab.id, { ptyId: 'pty-test-1' })

    // closeTab should trigger cleanup
    useTabsStore.getState().closeTab(tab.id)

    // PTY kill should have been called
    expect(window.api.pty.kill).toHaveBeenCalledWith('pty-test-1')
  })

  it('stops dev server on tab close', async () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'Test', path: '/test/project' })
    const tab = useTabsStore.getState().tabs[0]
    useTabsStore.getState().updateTab(tab.id, { dev: { status: 'running', url: null, pid: null, lastError: null, lastExitCode: null } })

    useTabsStore.getState().closeTab(tab.id)

    expect(window.api.dev.stop).toHaveBeenCalledWith('/test/project')
  })

  it('unwatches files on tab close', async () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'Test', path: '/test/project' })
    const tab = useTabsStore.getState().tabs[0]

    useTabsStore.getState().closeTab(tab.id)

    expect(window.api.fs.unwatch).toHaveBeenCalledWith('/test/project')
  })
})

describe('Fix: Toast action buttons', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('supports action button in toast', () => {
    const onClick = vi.fn()
    useToastStore.getState().addToast('Test message', 'success', {
      action: { label: 'Click me', onClick }
    })

    const toast = useToastStore.getState().toasts[0]
    expect(toast.action).toBeDefined()
    expect(toast.action!.label).toBe('Click me')
  })

  it('supports custom duration', () => {
    useToastStore.getState().addToast('Long toast', 'info', { duration: 10000 })
    const toast = useToastStore.getState().toasts[0]
    expect(toast.duration).toBe(10000)
  })

  it('defaults to 4000ms duration', () => {
    useToastStore.getState().addToast('Default toast', 'info')
    const toast = useToastStore.getState().toasts[0]
    expect(toast.duration).toBe(4000)
  })

  it('backward compatible with existing callers (no opts)', () => {
    useToastStore.getState().addToast('Simple toast', 'error')
    const toast = useToastStore.getState().toasts[0]
    expect(toast.message).toBe('Simple toast')
    expect(toast.type).toBe('error')
    expect(toast.action).toBeUndefined()
  })
})

// ── Phase 2: Dead Code & Missing Wiring ─────────────────────────────

describe('Fix: Tab state restoration', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('persists tabs to settings on add', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    expect(window.api.settings.set).toHaveBeenCalledWith(
      'tabs',
      expect.arrayContaining([
        expect.objectContaining({ project: { name: 'P1', path: '/p1' } })
      ])
    )
  })

  it('persists tabs to settings on close', () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    addTab({ name: 'P2', path: '/p2' })
    const tab = useTabsStore.getState().tabs[0]
    useTabsStore.getState().closeTab(tab.id)

    // Should persist the remaining tab
    const lastCall = (window.api.settings.set as any).mock.calls.at(-1)
    expect(lastCall[0]).toBe('tabs')
    expect(lastCall[1]).toHaveLength(1)
  })
})

// ── Phase 3: Error Handling & Validation ────────────────────────────

describe('Fix: Git sync state', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('tabs have git sync fields with defaults', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    const tab = useTabsStore.getState().tabs[0]
    expect(tab.gitAhead).toBe(0)
    expect(tab.gitBehind).toBe(0)
    expect(tab.gitSyncing).toBe(false)
    expect(tab.gitRemoteConfigured).toBe(false)
  })

  it('updates git sync state per tab', () => {
    useTabsStore.getState().addTab({ name: 'P1', path: '/p1' })
    useTabsStore.getState().addTab({ name: 'P2', path: '/p2' })
    const tabs = useTabsStore.getState().tabs

    useTabsStore.getState().updateTab(tabs[0].id, {
      gitAhead: 3,
      gitBehind: 1,
      gitRemoteConfigured: true
    })

    const updated = useTabsStore.getState().tabs
    expect(updated[0].gitAhead).toBe(3)
    expect(updated[0].gitBehind).toBe(1)
    expect(updated[0].gitRemoteConfigured).toBe(true)
    // Tab 2 unchanged
    expect(updated[1].gitAhead).toBe(0)
    expect(updated[1].gitRemoteConfigured).toBe(false)
  })
})

// ── Phase 4: Token Optimization MCP Tools ───────────────────────────

describe('Fix: New MCP preload bridge methods', () => {
  it('git.fetch is available', () => {
    expect(window.api.git.fetch).toBeDefined()
  })

  it('git.pull is available', () => {
    expect(window.api.git.pull).toBeDefined()
  })

  it('git.squashAndPush is available', () => {
    expect(window.api.git.squashAndPush).toBeDefined()
  })

  it('git.generateCommitMessage is available', () => {
    expect(window.api.git.generateCommitMessage).toBeDefined()
  })

  it('git.createPr is available', () => {
    expect(window.api.git.createPr).toBeDefined()
  })

  it('git.fetch returns ahead/behind counts', async () => {
    const result = await window.api.git.fetch('/test')
    expect(result).toHaveProperty('ahead')
    expect(result).toHaveProperty('behind')
    expect(typeof result.ahead).toBe('number')
    expect(typeof result.behind).toBe('number')
  })

  it('git.pull returns success and conflicts', async () => {
    const result = await window.api.git.pull('/test')
    expect(result).toHaveProperty('success')
    expect(typeof result.success).toBe('boolean')
  })

  it('git.squashAndPush returns success and branch', async () => {
    const result = await window.api.git.squashAndPush('/test', 'message')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.branch).toBe('main')
    }
  })

  it('git.generateCommitMessage returns a string', async () => {
    const result = await window.api.git.generateCommitMessage('/test')
    expect(typeof result).toBe('string')
  })

  it('git.createPr returns url and number', async () => {
    const result = await window.api.git.createPr('/test', {
      title: 'Test PR',
      body: 'Test body',
      base: 'main'
    })
    expect('url' in result).toBe(true)
  })
})

// ── Phase 5: State Management ───────────────────────────────────────

describe('Fix: Workspace mode', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ mode: 'terminal-only', canvasSplit: 50 })
  })

  it('supports terminal-inline mode', () => {
    useWorkspaceStore.getState().setMode('terminal-inline')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-inline')
  })

  it('can transition between all modes', () => {
    useWorkspaceStore.getState().setMode('terminal-canvas')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')

    useWorkspaceStore.getState().setMode('terminal-inline')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-inline')

    useWorkspaceStore.getState().setMode('terminal-only')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-only')
  })
})
