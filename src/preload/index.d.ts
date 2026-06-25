export interface GeneOApi {
  openFile(opts?: { filters?: { name: string; extensions: string[] }[] }): Promise<{
    canceled: boolean
    path?: string
    name?: string
    content?: string
  }>
  saveFile(args: {
    content: string
    defaultName?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<{ canceled: boolean; path?: string }>
  saveImage(args: { dataUrl: string; defaultName?: string }): Promise<{
    canceled: boolean
    path?: string
  }>
}

declare global {
  interface Window {
    api: GeneOApi
  }
}
