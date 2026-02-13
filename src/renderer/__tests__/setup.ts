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
  fs: {
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
    show: vi.fn().mockResolvedValue('')
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
      start: vi.fn().mockResolvedValue({ token: 'test-token' }),
      status: vi.fn().mockResolvedValue({ connected: false }),
      logout: vi.fn().mockResolvedValue(undefined)
    }
  },
  dev: {
    start: vi.fn().mockResolvedValue({ port: 3000, pid: 12345 }),
    stop: vi.fn().mockResolvedValue(undefined),
    onOutput: vi.fn().mockReturnValue(vi.fn()),
    onExit: vi.fn().mockReturnValue(vi.fn())
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
    onNotify: vi.fn().mockReturnValue(() => {})
  }
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true })
