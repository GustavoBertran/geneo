import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { useStore } from '@state/store'
import { puc19 } from '@data/puc19'
import { sampleGenome } from '@data/genome'

// Seed the app with the real pUC19 cloning vector on first load.
useStore.getState().setRecord(puc19)
// Seed the genome browser with the bundled sample assembly.
useStore.getState().setAssembly(sampleGenome)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
