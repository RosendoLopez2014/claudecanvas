import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  pty: {
    spawn: (shell?: string): Promise<string> => ipcRenderer.invoke('pty:spawn', shell),
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

  fs: {
    watch: (path: string) => ipcRenderer.invoke('fs:watch', path),
    unwatch: () => ipcRenderer.invoke('fs:unwatch'),
    onChange: (cb: (path: string) => void) => {
      const handler = (_: unknown, path: string) => cb(path)
      ipcRenderer.on('fs:change', handler)
      return () => ipcRenderer.removeListener('fs:change', handler)
    },
    onAdd: (cb: (path: string) => void) => {
      const handler = (_: unknown, path: string) => cb(path)
      ipcRenderer.on('fs:add', handler)
      return () => ipcRenderer.removeListener('fs:add', handler)
    },
    onUnlink: (cb: (path: string) => void) => {
      const handler = (_: unknown, path: string) => cb(path)
      ipcRenderer.on('fs:unlink', handler)
      return () => ipcRenderer.removeListener('fs:unlink', handler)
    }
  },

  render: {
    evaluate: (html: string, css?: string) =>
      ipcRenderer.invoke('render:evaluate', html, css)
  },

  git: {
    init: (cwd: string) => ipcRenderer.invoke('git:init', cwd),
    status: () => ipcRenderer.invoke('git:status'),
    branch: () => ipcRenderer.invoke('git:branch'),
    log: (maxCount?: number) => ipcRenderer.invoke('git:log', maxCount),
    checkpoint: (message: string) => ipcRenderer.invoke('git:checkpoint', message),
    diff: (hash?: string) => ipcRenderer.invoke('git:diff', hash),
    show: (hash: string, filePath: string) => ipcRenderer.invoke('git:show', hash, filePath)
  },

  oauth: {
    github: {
      start: () => ipcRenderer.invoke('oauth:github:start'),
      status: () => ipcRenderer.invoke('oauth:github:status'),
      logout: () => ipcRenderer.invoke('oauth:github:logout')
    },
    vercel: {
      start: () => ipcRenderer.invoke('oauth:vercel:start'),
      status: () => ipcRenderer.invoke('oauth:vercel:status'),
      logout: () => ipcRenderer.invoke('oauth:vercel:logout')
    },
    supabase: {
      start: () => ipcRenderer.invoke('oauth:supabase:start'),
      status: () => ipcRenderer.invoke('oauth:supabase:status'),
      logout: () => ipcRenderer.invoke('oauth:supabase:logout')
    }
  },

  dev: {
    start: (cwd: string, command?: string) => ipcRenderer.invoke('dev:start', cwd, command),
    stop: () => ipcRenderer.invoke('dev:stop'),
    onOutput: (cb: (data: string) => void) => {
      const handler = (_: unknown, data: string) => cb(data)
      ipcRenderer.on('dev:output', handler)
      return () => ipcRenderer.removeListener('dev:output', handler)
    },
    onExit: (cb: (code: number) => void) => {
      const handler = (_: unknown, code: number) => cb(code)
      ipcRenderer.on('dev:exit', handler)
      return () => ipcRenderer.removeListener('dev:exit', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
