import { app, shell, BrowserWindow, ipcMain, dialog, session } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/**
 * Apply a Content-Security-Policy via response headers for production builds.
 * We avoid a static <meta> CSP in index.html because it would also constrain the
 * Vite dev server's HMR. The renderer only ever loads local bundled assets.
 */
function applyCsp(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
        ]
      }
    })
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#1b1e25',
    title: 'GeneO',
    // macOS uses the bundle .icns; this sets the icon on Windows/Linux.
    ...(process.platform !== 'darwin' ? { icon: join(__dirname, '../../resources/icon.png') } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // electron-vite emits the preload as .mjs under "type": "module"
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite injects this env var in dev; load the dev server, else the built file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- IPC: file system bridge --------------------------------------------

interface OpenResult {
  canceled: boolean
  path?: string
  name?: string
  content?: string
}

interface OpenArgs {
  filters?: { name: string; extensions: string[] }[]
}

ipcMain.handle('file:open', async (_e, args?: OpenArgs): Promise<OpenResult> => {
  const res = await dialog.showOpenDialog({
    title: 'Open file',
    properties: ['openFile'],
    filters: args?.filters ?? [
      { name: 'Sequence files', extensions: ['gb', 'gbk', 'genbank', 'ape', 'fasta', 'fa', 'fna', 'seq', 'txt'] },
      { name: 'GenBank', extensions: ['gb', 'gbk', 'genbank', 'ape'] },
      { name: 'FASTA', extensions: ['fasta', 'fa', 'fna'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (res.canceled || res.filePaths.length === 0) return { canceled: true }
  const path = res.filePaths[0]
  const content = await readFile(path, 'utf-8')
  return { canceled: false, path, name: path.split(/[/\\]/).pop(), content }
})

interface SaveArgs {
  content: string
  defaultName?: string
  filters?: { name: string; extensions: string[] }[]
}

ipcMain.handle('file:save', async (_e, args: SaveArgs): Promise<{ canceled: boolean; path?: string }> => {
  const res = await dialog.showSaveDialog({
    title: 'Save',
    defaultPath: args.defaultName ?? 'sequence.gb',
    filters: args.filters ?? [
      { name: 'GenBank', extensions: ['gb'] },
      { name: 'FASTA', extensions: ['fasta'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (res.canceled || !res.filePath) return { canceled: true }
  await writeFile(res.filePath, args.content, 'utf-8')
  return { canceled: false, path: res.filePath }
})

interface SaveImageArgs {
  /** A data URL, e.g. "data:image/png;base64,...." */
  dataUrl: string
  defaultName?: string
}

ipcMain.handle(
  'file:save-image',
  async (_e, args: SaveImageArgs): Promise<{ canceled: boolean; path?: string }> => {
    const res = await dialog.showSaveDialog({
      title: 'Export snapshot',
      defaultPath: args.defaultName ?? 'snapshot.png',
      filters: [
        { name: 'PNG image', extensions: ['png'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    const base64 = args.dataUrl.replace(/^data:[^;]+;base64,/, '')
    await writeFile(res.filePath, Buffer.from(base64, 'base64'))
    return { canceled: false, path: res.filePath }
  }
)

app.whenReady().then(() => {
  applyCsp()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
