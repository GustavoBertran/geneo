import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { useStore } from '@state/store'
import { puc19 } from '@data/puc19'
import { sampleGenome, sampleGenomes } from '@data/genome'

// Seed the app with the real pUC19 cloning vector on first load.
useStore.getState().setRecord(puc19)
// Seed the genome browser with the bundled sample assembly.
useStore.getState().setAssembly(sampleGenome)

// On the very first run only, populate the Files list with the bundled samples
// so it isn't empty. A dedicated flag (not recentItems.length) is used so that
// "Clear all" stays cleared across restarts instead of re-seeding.
if (!localStorage.getItem('geneo.seeded')) {
  localStorage.setItem('geneo.seeded', '1')
  const add = useStore.getState().addRecent
  for (const g of [...sampleGenomes].reverse()) {
    add({
      kind: 'genome',
      name: g.name,
      subtitle: g.defaultLocus?.chrom ?? g.chromosomes[0]?.name ?? '',
      source: { type: 'sample-genome', assemblyId: g.id }
    })
  }
  add({
    kind: 'plasmid',
    name: puc19.name,
    subtitle: `${puc19.sequence.length.toLocaleString()} bp · ${puc19.topology}`,
    source: { type: 'sample-plasmid', sampleId: 'puc19' }
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
