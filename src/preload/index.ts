import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFile: (opts?: {
    filters?: { name: string; extensions: string[] }[]
  }): Promise<{
    canceled: boolean
    path?: string
    name?: string
    content?: string
  }> => ipcRenderer.invoke('file:open', opts),

  saveFile: (args: {
    content: string
    defaultName?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('file:save', args),

  saveImage: (args: {
    dataUrl: string
    defaultName?: string
  }): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('file:save-image', args)
}

contextBridge.exposeInMainWorld('api', api)

export type GeneOApi = typeof api
