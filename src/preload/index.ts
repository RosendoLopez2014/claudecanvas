import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    getBounds: () => ipcRenderer.invoke('window:getBounds') as Promise<{ x: number; y: number; width: number; height: number }>,
    setSize: (width: number, height: number, animate = true) =>
      ipcRenderer.invoke('window:setSize', width, height, animate)
  },

  pty: {
    spawn: (shell?: string, cwd?: string): Promise<string> => ipcRenderer.invoke('pty:spawn', shell, cwd),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    setCwd: (id: string, cwd: string) => ipcRenderer.send('pty:setCwd', id, cwd),
    onData: (id: string, cb: (data: string) => void) => {
      const handler = (_: unknown, data: string) => cb(data)
      ipcRenderer.on(`pty:data:${id}`, handler)
      return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
    },
    onExit: (id: string, cb: (exitCode: number) => void) => {
      const handler = (_: unknown, code: number) => cb(code)
      ipcRenderer.on(`pty:exit:${id}`, handler)
      return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
    }
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },

  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory')
  },

  framework: {
    detect: (projectPath: string) => ipcRenderer.invoke('framework:detect', projectPath),
  },

  component: {
    scan: (projectPath: string) => ipcRenderer.invoke('component:scan', projectPath) as Promise<
      Array<{ name: string; filePath: string; relativePath: string }>
    >,
    parse: (filePath: string) => ipcRenderer.invoke('component:parse', filePath) as Promise<{
      name: string
      filePath: string
      renderHtml: string
    } | null>,
  },

  template: {
    list: () => ipcRenderer.invoke('template:list'),
    scaffold: (opts: { templateId: string; projectName: string; parentDir: string }) =>
      ipcRenderer.invoke('template:scaffold', opts),
    onProgress: (cb: (data: { text: string }) => void) => {
      const handler = (_: unknown, data: { text: string }) => cb(data)
      ipcRenderer.on('template:progress', handler)
      return () => ipcRenderer.removeListener('template:progress', handler)
    }
  },

  search: {
    project: (rootPath: string, query: string, caseSensitive?: boolean) =>
      ipcRenderer.invoke('search:project', rootPath, query, caseSensitive) as Promise<
        Array<{ filePath: string; relativePath: string; lineNumber: number; lineContent: string }>
      >,
  },

  fs: {
    tree: (rootPath: string, depth?: number) =>
      ipcRenderer.invoke('fs:tree', rootPath, depth) as Promise<
        Array<{ name: string; path: string; type: 'file' | 'directory'; children?: unknown[] }>
      >,
    watch: (path: string) => ipcRenderer.invoke('fs:watch', path),
    unwatch: (path?: string) => ipcRenderer.invoke('fs:unwatch', path),
    onChange: (cb: (data: { projectPath: string; path: string }) => void) => {
      const handler = (_: unknown, data: { projectPath: string; path: string }) => cb(data)
      ipcRenderer.on('fs:change', handler)
      return () => ipcRenderer.removeListener('fs:change', handler)
    },
    onAdd: (cb: (data: { projectPath: string; path: string }) => void) => {
      const handler = (_: unknown, data: { projectPath: string; path: string }) => cb(data)
      ipcRenderer.on('fs:add', handler)
      return () => ipcRenderer.removeListener('fs:add', handler)
    },
    onUnlink: (cb: (data: { projectPath: string; path: string }) => void) => {
      const handler = (_: unknown, data: { projectPath: string; path: string }) => cb(data)
      ipcRenderer.on('fs:unlink', handler)
      return () => ipcRenderer.removeListener('fs:unlink', handler)
    }
  },

  visualDiff: {
    compare: (imageA: string, imageB: string) =>
      ipcRenderer.invoke('visual-diff:compare', imageA, imageB) as Promise<{ diffPercent: number } | null>,
  },

  screenshot: {
    capture: (rect: { x: number; y: number; width: number; height: number }): Promise<string> =>
      ipcRenderer.invoke('screenshot:capture', rect),
    captureCheckpoint: (hash: string, projectPath: string): Promise<string | null> =>
      ipcRenderer.invoke('screenshot:captureCheckpoint', hash, projectPath),
    loadCheckpoint: (hash: string, projectPath: string): Promise<string | null> =>
      ipcRenderer.invoke('screenshot:loadCheckpoint', hash, projectPath)
  },

  inspector: {
    inject: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('inspector:inject'),
    findFile: (componentName: string, projectPath: string): Promise<string | null> =>
      ipcRenderer.invoke('inspector:findFile', componentName, projectPath)
  },

  render: {
    evaluate: (html: string, css?: string) =>
      ipcRenderer.invoke('render:evaluate', html, css)
  },

  git: {
    init: (cwd: string) => ipcRenderer.invoke('git:init', cwd),
    status: (projectPath: string) => ipcRenderer.invoke('git:status', projectPath),
    branch: (projectPath: string) => ipcRenderer.invoke('git:branch', projectPath),
    log: (projectPath: string, maxCount?: number) => ipcRenderer.invoke('git:log', projectPath, maxCount),
    checkpoint: (projectPath: string, message: string) => ipcRenderer.invoke('git:checkpoint', projectPath, message),
    diff: (projectPath: string, hash?: string) => ipcRenderer.invoke('git:diff', projectPath, hash),
    diffBetween: (projectPath: string, fromHash: string, toHash: string) => ipcRenderer.invoke('git:diffBetween', projectPath, fromHash, toHash),
    show: (projectPath: string, hash: string, filePath: string) => ipcRenderer.invoke('git:show', projectPath, hash, filePath),
    remoteUrl: (projectPath: string) => ipcRenderer.invoke('git:remoteUrl', projectPath) as Promise<string | null>,
    getProjectInfo: (cwd: string) =>
      ipcRenderer.invoke('git:getProjectInfo', cwd) as Promise<{ remoteUrl: string | null; branch: string | null }>,
    setRemote: (cwd: string, remoteUrl: string) =>
      ipcRenderer.invoke('git:setRemote', cwd, remoteUrl) as Promise<{ ok: true } | { error: string }>,
    fetch: (projectPath: string) =>
      ipcRenderer.invoke('git:fetch', projectPath) as Promise<{ ahead: number; behind: number; error?: string }>,
    pull: (projectPath: string) =>
      ipcRenderer.invoke('git:pull', projectPath) as Promise<{ success: boolean; conflicts?: boolean; error?: string }>,
    squashAndPush: (projectPath: string, message: string) =>
      ipcRenderer.invoke('git:squashAndPush', projectPath, message) as Promise<
        { success: true; branch: string } | { success: false; error: string; needsPull?: boolean }
      >,
    generateCommitMessage: (projectPath: string) =>
      ipcRenderer.invoke('git:generateCommitMessage', projectPath) as Promise<string>,
    createPr: (projectPath: string, opts: { title: string; body: string; base: string }) =>
      ipcRenderer.invoke('git:createPr', projectPath, opts) as Promise<
        { url: string; number: number } | { error: string }
      >,
    cleanup: (projectPath: string) => ipcRenderer.invoke('git:cleanup', projectPath),
    rollback: (projectPath: string, hash: string) =>
      ipcRenderer.invoke('git:rollback', projectPath, hash) as Promise<{ success: boolean; error?: string }>,
    revertFile: (projectPath: string, hash: string, filePath: string) =>
      ipcRenderer.invoke('git:revertFile', projectPath, hash, filePath) as Promise<{ success: boolean; error?: string }>,
  },

  oauth: {
    github: {
      requestCode: () =>
        ipcRenderer.invoke('oauth:github:requestCode') as Promise<
          | { user_code: string; device_code: string; interval: number; expires_in: number }
          | { error: string }
        >,
      start: (args: {
        bounds: { x: number; y: number; width: number; height: number }
        deviceCode: string
        interval: number
        expiresIn: number
      }) => ipcRenderer.invoke('oauth:github:start', args),
      cancel: () => ipcRenderer.invoke('oauth:github:cancel'),
      updateBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
        ipcRenderer.send('oauth:github:updateBounds', bounds),
      status: () => ipcRenderer.invoke('oauth:github:status'),
      logout: () => ipcRenderer.invoke('oauth:github:logout'),
      listRepos: () =>
        ipcRenderer.invoke('oauth:github:listRepos') as Promise<
          Array<{ name: string; full_name: string; html_url: string; private: boolean }> | { error: string }
        >,
      createRepo: (opts: { name: string; private?: boolean }) =>
        ipcRenderer.invoke('oauth:github:createRepo', opts) as Promise<
          { url: string; owner: string } | { error: string }
        >,
      prStatus: (repoFullName: string, branch: string) =>
        ipcRenderer.invoke('oauth:github:prStatus', repoFullName, branch) as Promise<
          { hasPR: true; number: number; url: string; title: string } |
          { hasPR: false } |
          { error: string }
        >
    },
    vercel: {
      start: (args: {
        bounds: { x: number; y: number; width: number; height: number }
      }) => ipcRenderer.invoke('oauth:vercel:start', args) as Promise<
        { token: string } | { error: string }
      >,
      cancel: () => ipcRenderer.invoke('oauth:vercel:cancel'),
      updateBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
        ipcRenderer.send('oauth:vercel:updateBounds', bounds),
      status: () =>
        ipcRenderer.invoke('oauth:vercel:status') as Promise<{
          connected: boolean
          username?: string
          name?: string | null
          avatar?: string | null
        }>,
      logout: () => ipcRenderer.invoke('oauth:vercel:logout'),
      listProjects: () =>
        ipcRenderer.invoke('oauth:vercel:listProjects') as Promise<
          Array<{ id: string; name: string; framework: string | null; url: string | null }> | { error: string }
        >,
      deployments: (projectId: string) =>
        ipcRenderer.invoke('oauth:vercel:deployments', projectId) as Promise<
          | Array<{ id: string; url: string; state: string; created: number; source: string | null }>
          | { error: string }
        >,
      buildLogs: (deploymentId: string) =>
        ipcRenderer.invoke('oauth:vercel:buildLogs', deploymentId) as Promise<
          Array<{ text: string; created: number; type: string }> | { error: string }
        >,
      linkedProject: (args: { projectPath: string; gitRepo?: string }) =>
        ipcRenderer.invoke('oauth:vercel:linkedProject', args) as Promise<
          | {
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
          | { linked: false }
          | { error: string }
        >,
      importProject: (opts: { name: string; framework?: string; gitRepo: string }) =>
        ipcRenderer.invoke('oauth:vercel:importProject', opts) as Promise<
          { id: string; name: string; productionUrl: string } | { error: string }
        >,
      redeploy: (deploymentId: string) =>
        ipcRenderer.invoke('oauth:vercel:redeploy', deploymentId) as Promise<
          { id: string; url: string; state: string } | { error: string }
        >
    },
    supabase: {
      start: (args: {
        bounds: { x: number; y: number; width: number; height: number }
      }) => ipcRenderer.invoke('oauth:supabase:start', args) as Promise<
        { token: string } | { error: string }
      >,
      cancel: () => ipcRenderer.invoke('oauth:supabase:cancel'),
      updateBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
        ipcRenderer.send('oauth:supabase:updateBounds', bounds),
      status: () =>
        ipcRenderer.invoke('oauth:supabase:status') as Promise<{
          connected: boolean
          name?: string
          email?: string
          avatar_url?: string | null
        }>,
      logout: () => ipcRenderer.invoke('oauth:supabase:logout'),
      listProjects: () =>
        ipcRenderer.invoke('oauth:supabase:listProjects') as Promise<
          Array<{ id: string; name: string; ref: string; region: string; status: string }> | { error: string }
        >,
      projectDetails: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:projectDetails', projectRef) as Promise<
          { id: string; name: string; ref: string; region: string; status: string; dbHost: string } | { error: string }
        >,
      listTables: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listTables', projectRef) as Promise<
          Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }> | { error: string }
        >,
      runSql: (projectRef: string, sql: string) =>
        ipcRenderer.invoke('oauth:supabase:runSql', projectRef, sql) as Promise<
          { rows: unknown[]; rowCount: number } | { error: string }
        >,
      listFunctions: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listFunctions', projectRef) as Promise<
          Array<{ id: string; name: string; status: string; created_at: string }> | { error: string }
        >,
      listBuckets: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listBuckets', projectRef) as Promise<
          Array<{ id: string; name: string; public: boolean }> | { error: string }
        >,
      listPolicies: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:listPolicies', projectRef) as Promise<
          Array<{ table: string; name: string; command: string; definition: string }> | { error: string }
        >,
      getConnectionInfo: (projectRef: string) =>
        ipcRenderer.invoke('oauth:supabase:getConnectionInfo', projectRef) as Promise<
          { url: string; anonKey: string; serviceKey: string; dbUrl: string } | { error: string }
        >
    }
  },

  dev: {
    start: (cwd: string, command?: string) => ipcRenderer.invoke('dev:start', cwd, command),
    stop: (cwd?: string) => ipcRenderer.invoke('dev:stop', cwd),
    onOutput: (cb: (data: { cwd: string; data: string }) => void) => {
      const handler = (_: unknown, data: { cwd: string; data: string }) => cb(data)
      ipcRenderer.on('dev:output', handler)
      return () => ipcRenderer.removeListener('dev:output', handler)
    },
    onExit: (cb: (data: { cwd: string; code: number }) => void) => {
      const handler = (_: unknown, data: { cwd: string; code: number }) => cb(data)
      ipcRenderer.on('dev:exit', handler)
      return () => ipcRenderer.removeListener('dev:exit', handler)
    },
    onStatus: (cb: (status: { cwd?: string; stage: string; message: string; url?: string }) => void) => {
      const handler = (_: unknown, status: { cwd?: string; stage: string; message: string; url?: string }) => cb(status)
      ipcRenderer.on('dev:status', handler)
      return () => ipcRenderer.removeListener('dev:status', handler)
    }
  },

  mcp: {
    projectOpened: (projectPath: string) => ipcRenderer.invoke('mcp:project-opened', projectPath),
    projectClosed: () => ipcRenderer.invoke('mcp:project-closed'),

    onCanvasRender: (cb: (data: { projectPath?: string; html: string; css?: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; html: string; css?: string }) => cb(data)
      ipcRenderer.on('mcp:canvas-render', handler)
      return () => ipcRenderer.removeListener('mcp:canvas-render', handler)
    },
    onStartPreview: (cb: (data: { projectPath?: string; command?: string; cwd?: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; command?: string; cwd?: string }) => cb(data)
      ipcRenderer.on('mcp:start-preview', handler)
      return () => ipcRenderer.removeListener('mcp:start-preview', handler)
    },
    onStopPreview: (cb: (data: { projectPath?: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string }) => cb(data)
      ipcRenderer.on('mcp:stop-preview', handler)
      return () => ipcRenderer.removeListener('mcp:stop-preview', handler)
    },
    onSetPreviewUrl: (cb: (data: { projectPath?: string; url: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; url: string }) => cb(data)
      ipcRenderer.on('mcp:set-preview-url', handler)
      return () => ipcRenderer.removeListener('mcp:set-preview-url', handler)
    },
    onOpenTab: (cb: (data: { projectPath?: string; tab: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; tab: string }) => cb(data)
      ipcRenderer.on('mcp:open-tab', handler)
      return () => ipcRenderer.removeListener('mcp:open-tab', handler)
    },
    onAddToGallery: (cb: (data: { projectPath?: string; label: string; html: string; css?: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; label: string; html: string; css?: string }) => cb(data)
      ipcRenderer.on('mcp:add-to-gallery', handler)
      return () => ipcRenderer.removeListener('mcp:add-to-gallery', handler)
    },
    onCheckpoint: (cb: (data: { projectPath?: string; message: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; message: string }) => cb(data)
      ipcRenderer.on('mcp:checkpoint', handler)
      return () => ipcRenderer.removeListener('mcp:checkpoint', handler)
    },
    onNotify: (cb: (data: { projectPath?: string; message: string; type: string }) => void) => {
      const handler = (_: unknown, data: { projectPath?: string; message: string; type: string }) => cb(data)
      ipcRenderer.on('mcp:notify', handler)
      return () => ipcRenderer.removeListener('mcp:notify', handler)
    }
  },

  worktree: {
    list: (projectPath: string) =>
      ipcRenderer.invoke('worktree:list', projectPath) as Promise<
        Array<{ path: string; branch: string; head: string }>
      >,
    create: (opts: { projectPath: string; branchName: string; targetDir: string }) =>
      ipcRenderer.invoke('worktree:create', opts) as Promise<{ path: string; branch: string }>,
    checkout: (opts: { projectPath: string; branchName: string; targetDir: string }) =>
      ipcRenderer.invoke('worktree:checkout', opts) as Promise<{ path: string; branch: string }>,
    remove: (opts: { projectPath: string; worktreePath: string }) =>
      ipcRenderer.invoke('worktree:remove', opts) as Promise<{ ok: true }>,
    branches: (projectPath: string) =>
      ipcRenderer.invoke('worktree:branches', projectPath) as Promise<{
        current: string
        branches: string[]
      }>
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
