import { Toolbar } from '@components/Toolbar'
import { Sidebar } from '@components/Sidebar'
import { StatusBar } from '@components/StatusBar'
import { CenterView } from '@components/CenterView'
import { InspectorPanel } from '@components/InspectorPanel'
import { GenomeBrowser } from '@components/genome/GenomeBrowser'
import { FilesView } from '@components/FilesView'
import { Logo } from '@components/Logo'
import { useStore } from '@state/store'

export default function App(): JSX.Element {
  const record = useStore((s) => s.record)
  const viewMode = useStore((s) => s.viewMode)

  // The genome browser and Files list are full-width tools with their own
  // layout; neither depends on an open plasmid record.
  if (viewMode === 'genome' || viewMode === 'files') {
    return (
      <div className="app" style={{ gridTemplateRows: 'auto 1fr' }}>
        <Toolbar />
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {viewMode === 'genome' ? <GenomeBrowser /> : <FilesView />}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <Sidebar />
        <div className="app-center">
          {record ? (
            <CenterView />
          ) : (
            <div className="empty-state">
              <Logo size={72} withTile />
              <div style={{ fontSize: 22, fontWeight: 600 }}>GeneO</div>
              <div className="dim">Open a GenBank or FASTA file to begin.</div>
            </div>
          )}
        </div>
        <InspectorPanel />
      </div>
      <StatusBar />
    </div>
  )
}
