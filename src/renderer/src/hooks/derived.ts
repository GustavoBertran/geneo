/**
 * Shared memoized selectors that derive heavy analysis data from the store.
 * Components MUST use these rather than re-deriving cut sites / ORFs / enzyme
 * objects themselves, so everything stays consistent and is computed once.
 */
import { useMemo } from 'react'
import { useStore } from '@state/store'
import { ENZYMES, findCutSites, digest } from '@core/enzymes'
import { findOrfs } from '@core/translation'
import type { CutSite, Enzyme, Fragment, Orf } from '@core/types'

/** Resolve the enabled enzyme NAMES into full Enzyme objects from the DB. */
export function useEnabledEnzymeObjects(): Enzyme[] {
  const enabled = useStore((s) => s.enabledEnzymes)
  return useMemo(() => {
    const byName = new Map(ENZYMES.map((e) => [e.name, e]))
    return enabled.map((n) => byName.get(n)).filter((e): e is Enzyme => Boolean(e))
  }, [enabled])
}

/** Cut sites for the currently enabled enzymes against the open record. */
export function useCutSites(): CutSite[] {
  const record = useStore((s) => s.record)
  const enzymes = useEnabledEnzymeObjects()
  return useMemo(() => (record ? findCutSites(record, enzymes) : []), [record, enzymes])
}

/** Digestion fragments for the currently enabled enzymes. */
export function useFragments(): Fragment[] {
  const record = useStore((s) => s.record)
  const enzymes = useEnabledEnzymeObjects()
  return useMemo(() => (record ? digest(record, enzymes) : []), [record, enzymes])
}

/** ORFs in the open record above the given minimum amino-acid length. */
export function useOrfs(minAA = 75): Orf[] {
  const record = useStore((s) => s.record)
  return useMemo(() => (record ? findOrfs(record, { minAA }) : []), [record, minAA])
}
