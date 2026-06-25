/**
 * The real pUC19 cloning vector (GenBank L09137, 2686 bp), bundled as a
 * second sample so the app can be exercised on an authentic plasmid.
 *
 * The NCBI record itself carries only a bare `source` feature, so we derive the
 * canonical annotations with GeneO's own engines at load time. This keeps the
 * annotations guaranteed-consistent with the actual sequence and doubles as a
 * live demonstration that the ORF finder lands on real genes:
 *   - AmpR (bla)  = the single longest ORF in the plasmid (~286 aa, reverse strand)
 *   - lacZα       = the ORF spanning the multiple cloning site
 *   - MCS         = the pUC19 polylinker, located by exact substring match
 */
import type { Feature, Orf, SeqRecord } from '@core/types'
import { findOrfs } from '@core/translation'

const PUC19_SEQUENCE =
  "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGAT" +
  "GCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGA" +
  "GCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCC" +
  "ATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGG" +
  "GGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATT" +
  "CGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGTTTCCT" +
  "GTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATG" +
  "AGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAAT" +
  "GAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCTCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCG" +
  "GTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGGCGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGG" +
  "AAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAGGAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCC" +
  "GCCCCCCTGACGAGCATCACAAAAATCGACGCTCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCG" +
  "TTTCCCCCTGGAAGCTCCCTCGTGCGCTCTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTC" +
  "GGGAAGCGTGGCGCTTTCTCATAGCTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTG" +
  "TGCACGAACCCCCCGTTCAGCCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGAC" +
  "TTATCGCCACTGGCAGCAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTG" +
  "GTGGCCTAACTACGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAG" +
  "TTGGTAGCTCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGA" +
  "AAAAAAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGAT" +
  "TTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAAAGTA" +
  "TATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTATTTCGTTCA" +
  "TCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAGTGCTGCAATGAT" +
  "ACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCCGAGCGCAGAAGTGGTC" +
  "CTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTAGTTCGCCAGTTAATAGTTTG" +
  "CGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTATGGCTTCATTCAGCTCCGGTTCCCA" +
  "ACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGCTCCTTCGGTCCTCCGATCGTTGTCAGAA" +
  "GTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATAATTCTCTTACTGTCATGCCATCCGTAAGATGC" +
  "TTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATAGTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTC" +
  "AATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAAGTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCT" +
  "CAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGTAACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTC" +
  "ACCAGCGTTTCTGGGTGAGCAAAAACAGGAAGGCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAAT" +
  "ACTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTA" +
  "TTTAGAAAAATAAACAAATAGGGGTTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATC" +
  "ATGACATTAACCTATAAAAATAGGCGTATCACGAGGCCCTTTCGTC"

// The canonical pUC19 multiple cloning site (EcoRI -> HindIII).
const MCS = 'GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTT'

/** Does a (possibly origin-wrapping) ORF cover top-strand position p? */
function orfCovers(o: Orf, p: number, len: number): boolean {
  if (o.end >= o.start) return p >= o.start && p < o.end
  // wraps origin
  return p >= o.start || p < o.end
  void len
}

function buildPuc19(): SeqRecord {
  const seq = PUC19_SEQUENCE.replace(/\s/g, '').toUpperCase()
  const len = seq.length
  const base: SeqRecord = {
    id: 'puc19',
    name: 'pUC19',
    description: 'Cloning vector pUC19 (GenBank L09137), 2686 bp — high-copy E. coli plasmid',
    sequence: seq,
    topology: 'circular',
    features: []
  }

  const features: Feature[] = []

  // AmpR / bla — the longest ORF in the plasmid.
  const orfs = findOrfs(base, { minAA: 80, requireStart: true })
  const byLen = [...orfs].sort((a, b) => b.length - a.length)
  const ampr = byLen[0]
  if (ampr) {
    features.push({
      id: 'puc_ampr',
      name: 'AmpR',
      type: 'CDS',
      start: ampr.start,
      end: ampr.end,
      strand: ampr.strand,
      qualifiers: { gene: 'bla', product: 'β-lactamase (ampicillin resistance)' },
      translation: ampr.protein
    })
  }

  // MCS — exact polylinker match (forward strand in L09137).
  const mcsIdx = seq.indexOf(MCS)
  if (mcsIdx >= 0) {
    features.push({
      id: 'puc_mcs',
      name: 'MCS',
      type: 'misc_feature',
      start: mcsIdx,
      end: mcsIdx + MCS.length,
      strand: 1,
      qualifiers: { note: 'pUC19 multiple cloning site (EcoRI…HindIII polylinker)' }
    })

    // lacZα — the ORF spanning the MCS (the polylinker sits inside lacZα).
    const mcsMid = mcsIdx + Math.floor(MCS.length / 2)
    const lacOrfs = findOrfs(base, { minAA: 25, requireStart: true })
    const lacz = lacOrfs
      .filter((o) => o !== ampr && orfCovers(o, mcsMid, len))
      .sort((a, b) => b.length - a.length)[0]
    if (lacz) {
      features.push({
        id: 'puc_lacza',
        name: 'lacZα',
        type: 'CDS',
        start: lacz.start,
        end: lacz.end,
        strand: lacz.strand,
        qualifiers: { gene: 'lacZα', product: 'LacZ-alpha fragment (blue/white selection)' },
        translation: lacz.protein
      })
    }
  }

  return { ...base, features }
}

export const puc19: SeqRecord = buildPuc19()
