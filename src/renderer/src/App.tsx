import { Toolbar } from '@components/Toolbar'
import { Sidebar } from '@components/Sidebar'
import { StatusBar } from '@components/StatusBar'
import { CenterView } from '@components/CenterView'
import { InspectorPanel } from '@components/InspectorPanel'
import { GenomeBrowser } from '@components/genome/GenomeBrowser'
import { Logo } from '@components/Logo'
import { useStore } from '@state/store'

export default function App(): JSX.Element {
  const record = useStore((s) => s.record)
  const viewMode = useStore((s) => s.viewMode)

  // The genome browser is a chromosome-scale tool with its own layout; it does
  // not depend on an open plasmid record.
  if (viewMode === 'genome') {
    return (
      <div className="app" style={{ gridTemplateRows: 'auto 1fr' }}>
        <Toolbar />
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          <GenomeBrowser />
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
