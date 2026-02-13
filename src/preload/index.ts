import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
