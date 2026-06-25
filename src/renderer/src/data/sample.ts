/**
 * A bundled demo plasmid so the app shows something real on first launch.
 *
 * The sequence is assembled deterministically (fixed-seed PRNG filler) but with
 * REAL, biologically meaningful inserts:
 *   - an authentic pUC19-style multiple cloning site with genuine restriction
 *     sites (EcoRI, SacI, KpnI, SmaI/XmaI, BamHI, XbaI, SalI, PstI, SphI, HindIII)
 *   - two clean protein-coding ORFs (no internal stop codons) so ORF finding,
 *     translation and primer design all have honest substrate to work on.
 */
import type { Feature, SeqRecord } from '@core/types'
import { reverseComplement } from '@core/sequence'

// --- deterministic PRNG (mulberry32) ---------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASES = 'ACGT'

function randomDna(rng: () => number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += BASES[Math.floor(rng() * 4)]
  return s
}

// A deterministic, stop-free codon for each amino acid (no TAA/TAG/TGA).
const AA_CODON: Record<string, string> = {
  A: 'GCT', R: 'CGT', N: 'AAC', D: 'GAT', C: 'TGT', Q: 'CAA', E: 'GAA',
  G: 'GGT', H: 'CAT', I: 'ATT', L: 'CTG', K: 'AAA', M: 'ATG', F: 'TTT',
  P: 'CCT', S: 'TCT', T: 'ACT', W: 'TGG', Y: 'TAT', V: 'GTT'
}

/** Build a clean CDS (ATG ... TAA) encoding a pseudo-random protein of `aa` residues. */
function buildOrf(rng: () => number, aa: number): string {
  const residues = 'ARNDCQEGHILKMFPSTWYV'
  let cds = 'ATG'
  for (let i = 0; i < aa - 1; i++) {
    const r = residues[Math.floor(rng() * residues.length)]
    cds += AA_CODON[r]
  }
  cds += 'TAA' // stop
  return cds
}

// Authentic pUC19 polylinker (EcoRI -> HindIII), 57 bp.
const MCS = 'GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTT'

function buildSample(): SeqRecord {
  const rng = mulberry32(0x9e3779b9)

  // Region layout (assembled left to right).
  const lacPromoter = 'TTTACACTTTATGCTTCCGGCTCGTATGTTGTGTGGAATTGTGAGCGGATAACAATTTCACACAGGA' // ~66 bp, real lac/CAP-ish
  const ampR = buildOrf(rng, 286) // ~861 bp clean ORF (β-lactamase-sized)
  const ori = randomDna(rng, 589) // origin region placeholder
  const lacZa = buildOrf(rng, 99) // ~300 bp lacZ-alpha-sized clean ORF
  // rop sits on the reverse strand: store the revcomp of a clean forward ORF so
  // that reading the bottom strand 5'->3' yields a clean protein (ATG...stop).
  const rop = reverseComplement(buildOrf(rng, 63)) // ~192 bp small ORF, reverse strand

  const parts: { name: string; seq: string }[] = [
    { name: 'spacer1', seq: randomDna(rng, 120) },
    { name: 'lacZa_promoter', seq: lacPromoter },
    { name: 'MCS', seq: MCS },
    { name: 'lacZa', seq: lacZa },
    { name: 'spacer2', seq: randomDna(rng, 140) },
    { name: 'ori', seq: ori },
    { name: 'spacer3', seq: randomDna(rng, 90) },
    { name: 'AmpR', seq: ampR },
    { name: 'spacer4', seq: randomDna(rng, 110) },
    { name: 'rop', seq: rop },
    { name: 'spacer5', seq: randomDna(rng, 80) }
  ]

  let sequence = ''
  const offsets: Record<string, { start: number; end: number }> = {}
  for (const p of parts) {
    const start = sequence.length
    sequence += p.seq
    offsets[p.name] = { start, end: sequence.length }
  }

  const features: Feature[] = [
    {
      id: 'feat_lacprom',
      name: 'lac promoter',
      type: 'promoter',
      start: offsets.lacZa_promoter.start,
      end: offsets.lacZa_promoter.end,
      strand: 1,
      qualifiers: { note: 'promoter for the E. coli lac operon' }
    },
    {
      id: 'feat_mcs',
      name: 'MCS',
      type: 'misc_feature',
      start: offsets.MCS.start,
      end: offsets.MCS.end,
      strand: 1,
      qualifiers: { note: 'pUC19 multiple cloning site' }
    },
    {
      id: 'feat_lacza',
      name: 'lacZα',
      type: 'CDS',
      start: offsets.lacZa.start,
      end: offsets.lacZa.end,
      strand: 1,
      qualifiers: { product: 'LacZ-alpha fragment' }
    },
    {
      id: 'feat_ori',
      name: 'ori',
      type: 'rep_origin',
      start: offsets.ori.start,
      end: offsets.ori.end,
      strand: 1,
      qualifiers: { note: 'high-copy-number ColE1/pMB1 origin of replication' }
    },
    {
      id: 'feat_ampr',
      name: 'AmpR',
      type: 'CDS',
      start: offsets.AmpR.start,
      end: offsets.AmpR.end,
      strand: 1,
      qualifiers: { product: 'β-lactamase (ampicillin resistance)', gene: 'bla' }
    },
    {
      id: 'feat_rop',
      name: 'rop',
      type: 'CDS',
      start: offsets.rop.start,
      end: offsets.rop.end,
      strand: -1,
      qualifiers: { product: 'Rop / Rom copy-number control protein' }
    }
  ]

  return {
    id: 'sample_pgeneo',
    name: 'pGeneO-Demo',
    description: 'Demonstration cloning vector (synthetic) with a pUC19-style MCS',
    sequence,
    topology: 'circular',
    features
  }
}

export const samplePlasmid: SeqRecord = buildSample()
