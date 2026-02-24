import { ipcMain } from 'electron'

let cachedSelection: { variantId: string } | null = null

export function setupGalleryIpc(): void {
  ipcMain.on('gallery:select-variant', (_event, variantId: string) => {
    cachedSelection = { variantId }
  })
}

export function getGallerySelection(): { variantId: string } | null {
  return cachedSelection
}

export function clearGallerySelection(): void {
  cachedSelection = null
}
