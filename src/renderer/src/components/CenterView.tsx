import { useStore } from '@state/store'
import { CircularMap } from './CircularMap'
import { LinearMap } from './LinearMap'
import { SequenceView } from './SequenceView'
import { EnzymePanel } from './EnzymePanel'
import { OrfPanel } from './OrfPanel'
import { PrimerPanel } from './PrimerPanel'

/** Switches the main center area based on the active view mode. */
export function CenterView(): JSX.Element {
  const viewMode = useStore((s) => s.viewMode)
  const mapStyle = useStore((s) => s.mapStyle)

  switch (viewMode) {
    case 'map':
      return mapStyle === 'circular' ? <CircularMap /> : <LinearMap />
    case 'sequence':
      return <SequenceView />
    case 'enzymes':
      return <EnzymePanel />
    case 'orfs':
      return <OrfPanel />
    case 'primers':
      return <PrimerPanel />
    default:
      return <CircularMap />
  }
}
