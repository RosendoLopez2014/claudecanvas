// Mock window.api for all renderer tests
const mockApi = {
  platform: 'darwin',
  window: {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false)
  },
  pty: {
    spawn: vi.fn().mockResolvedValue('pty-1'),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    setCwd: vi.fn(),
    onData: vi.fn().mockReturnValue(vi.fn()),
    onExit: vi.fn().mockReturnValue(vi.fn())
  },
  settings: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue({})
  },
  dialog: {
    selectDirectory: vi.fn().mockResolvedValue(null)
  },
  component: {
    scan: vi.fn().mockResolvedValue([]),
    parse: vi.fn().mockResolvedValue(null),
  },
  search: {
    project: vi.fn().mockResolvedValue([]),
  },
  visualDiff: {
    compare: vi.fn().mockResolvedValue({ diffPercent: 0 }),
  },
  template: {
    list: vi.fn().mockResolvedValue([]),
    scaffold: vi.fn().mockResolvedValue({ success: true, path: '/tmp/test-project' }),
    onProgress: vi.fn().mockReturnValue(vi.fn())
  },
  fs: {
    tree: vi.fn().mockResolvedValue([]),
    watch: vi.fn().mockResolvedValue(true),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn().mockReturnValue(vi.fn()),
    onAdd: vi.fn().mockReturnValue(vi.fn()),
    onUnlink: vi.fn().mockReturnValue(vi.fn())
  },
  render: {
    evaluate: vi.fn().mockResolvedValue({ target: 'canvas', width: 800, height: 600 })
  },
  git: {
    init: vi.fn().mockResolvedValue(true),
    status: vi.fn().mockResolvedValue(null),
    branch: vi.fn().mockResolvedValue({ current: 'main', branches: ['main'] }),
    log: vi.fn().mockResolvedValue([]),
    checkpoint: vi.fn().mockResolvedValue({ hash: 'abc123', message: 'test' }),
    diff: vi.fn().mockResolvedValue(''),
    diffBetween: vi.fn().mockResolvedValue(''),
    show: vi.fn().mockResolvedValue(''),
    remoteUrl: vi.fn().mockResolvedValue(null),
    getProjectInfo: vi.fn().mockResolvedValue({ remoteUrl: null, branch: null }),
    setRemote: vi.fn().mockResolvedValue({ ok: true }),
    fetch: vi.fn().mockResolvedValue({ ahead: 0, behind: 0 }),
    pull: vi.fn().mockResolvedValue({ success: true, conflicts: false }),
    squashAndPush: vi.fn().mockResolvedValue({ success: true, branch: 'main' }),
    generateCommitMessage: vi.fn().mockResolvedValue('Update components'),
    createPr: vi.fn().mockResolvedValue({ url: 'https://github.com/test/repo/pull/1', number: 1 }),
    cleanup: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue({ success: true }),
    revertFile: vi.fn().mockResolvedValue({ success: true }),
  },
  oauth: {
    github: {
      start: vi.fn().mockResolvedValue({ token: 'test-token' }),
      status: vi.fn().mockResolvedValue({ connected: false }),
      logout: vi.fn().mockResolvedValue(undefined)
    },
    vercel: {
      start: vi.fn().mockResolvedValue({ token: 'test-token' }),
      status: vi.fn().mockResolvedValue({ connected: false }),
      logout: vi.fn().mockResolvedValue(undefined)
    },
    supabase: {
      start: vi.fn().mockResolvedValue({ token: 'sb-test-token' }),
      cancel: vi.fn().mockResolvedValue({ cancelled: true }),
      updateBounds: vi.fn(),
      status: vi.fn().mockResolvedValue({ connected: false }),
      logout: vi.fn().mockResolvedValue(undefined),
      listProjects: vi.fn().mockResolvedValue([]),
      projectDetails: vi.fn().mockResolvedValue({ error: 'Not connected' }),
      listTables: vi.fn().mockResolvedValue([]),
      runSql: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      listFunctions: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue([]),
      listPolicies: vi.fn().mockResolvedValue([]),
      getConnectionInfo: vi.fn().mockResolvedValue({ error: 'Not connected' }),
      onExpired: vi.fn().mockReturnValue(vi.fn())
    }
  },
  dev: {
    start: vi.fn().mockResolvedValue({ port: 3000, pid: 12345 }),
    stop: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ running: false, url: null }),
    clearCrashHistory: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue({
      plan: { cwd: '/tmp/test', manager: 'npm', command: { bin: 'npm', args: ['run', 'dev'] }, confidence: 'high', reasons: [], detection: {} },
      needsVerification: false,
    }),
    setOverride: vi.fn().mockResolvedValue({ ok: true }),
    clearOverride: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue(null),
    onOutput: vi.fn().mockReturnValue(vi.fn()),
    onExit: vi.fn().mockReturnValue(vi.fn()),
    onStatus: vi.fn().mockReturnValue(vi.fn())
  },
  mcp: {
    projectOpened: vi.fn().mockResolvedValue({ port: 9315 }),
    projectClosed: vi.fn().mockResolvedValue(undefined),
    onCanvasRender: vi.fn().mockReturnValue(() => {}),
    onStartPreview: vi.fn().mockReturnValue(() => {}),
    onStopPreview: vi.fn().mockReturnValue(() => {}),
    onSetPreviewUrl: vi.fn().mockReturnValue(() => {}),
    onOpenTab: vi.fn().mockReturnValue(() => {}),
    onAddToGallery: vi.fn().mockReturnValue(() => {}),
    onCheckpoint: vi.fn().mockReturnValue(() => {}),
    onNotify: vi.fn().mockReturnValue(() => {}),
    onDesignSession: vi.fn().mockReturnValue(() => {}),
    onUpdateVariant: vi.fn().mockReturnValue(() => {}),
    gallerySelect: vi.fn()
  }
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true })
