/**
 * Numeric verification of the GeneO engines against the bundled sample plasmid.
 * Run with: npm run verify   (vite-node, full alias resolution)
 *
 * typecheck/build cannot catch numerically-wrong engines — this can. Exits 1 on
 * any failed assertion.
 */
import { samplePlasmid } from '@data/sample'
import { reverseComplement, subsequence, spanLength, gcContent } from '@core/sequence'
import { parseFasta, serializeFasta } from '@core/fasta'
import { parseGenBank, serializeGenBank } from '@core/genbank'
import { translate, CODON_TABLE, findOrfs } from '@core/translation'
import { ENZYMES, findCutSites, digest, cutCounts, getEnzyme } from '@core/enzymes'
import { calcTm, findPrimerBindingSites, designPrimers, analyzePrimer } from '@core/primers'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(t: string): void {
  console.log(`\n\x1b[1m${t}\x1b[0m`)
}

const rec = samplePlasmid
const seq = rec.sequence
const len = seq.length

// Count occurrences of an exact pattern in a circular sequence.
function circularCount(s: string, pat: string): number {
  const ext = s + s.slice(0, pat.length - 1)
  let n = 0
  let i = ext.indexOf(pat)
  while (i !== -1 && i < s.length) {
    n++
    i = ext.indexOf(pat, i + 1)
  }
  return n
}

// ---------------------------------------------------------------------------
section(`Sample plasmid: ${rec.name} (${len} bp, ${rec.topology})`)
check('sample is non-trivial length', len > 1500, `len=${len}`)
check('sample is circular', rec.topology === 'circular')
check('sample has features', rec.features.length >= 5, `${rec.features.length} features`)

// ---------------------------------------------------------------------------
section('Genetic code & translation')
check('CODON_TABLE has 64 codons', Object.keys(CODON_TABLE).length === 64, `${Object.keys(CODON_TABLE).length}`)
check('TAA/TAG/TGA are stops', CODON_TABLE['TAA'] === '*' && CODON_TABLE['TAG'] === '*' && CODON_TABLE['TGA'] === '*')
check('ATG=M, TTT=F, GGG=G', CODON_TABLE['ATG'] === 'M' && CODON_TABLE['TTT'] === 'F' && CODON_TABLE['GGG'] === 'G')
check("translate('ATGAAATAA')==='MK*'", translate('ATGAAATAA') === 'MK*', translate('ATGAAATAA'))

for (const fname of ['AmpR', 'lacZα']) {
  const f = rec.features.find((x) => x.name === fname)
  if (!f) { check(`${fname} feature exists`, false); continue }
  const dna = f.strand === 1
    ? subsequence(seq, f.start, f.end, rec.topology)
    : reverseComplement(subsequence(seq, f.start, f.end, rec.topology))
  const prot = translate(dna)
  const internalStops = prot.slice(0, -1).includes('*')
  check(`${fname} CDS has no internal stop codons`, !internalStops, prot.slice(0, 12) + '…')
  check(`${fname} CDS starts with M`, prot.startsWith('M'))
}

// ---------------------------------------------------------------------------
section('ORF finding')
const orfs = findOrfs(rec, { minAA: 75 })
check('finds at least one ORF', orfs.length >= 1, `${orfs.length} ORFs`)
const bigFwd = orfs.find((o) => o.strand === 1 && o.length >= 280)
check('finds the long AmpR-sized forward ORF (>=280 aa)', !!bigFwd, bigFwd ? `len=${bigFwd.length}` : 'none')
check('all ORF proteins have no internal stops', orfs.every((o) => !o.protein.slice(0, -1).includes('*')))
const orfsLow = findOrfs(rec, { minAA: 50 })
check('reverse-strand ORF detected (rop, minAA 50)', orfsLow.some((o) => o.strand === -1), `${orfsLow.filter(o => o.strand === -1).length} rev ORFs`)

// ---------------------------------------------------------------------------
section('Restriction enzymes')
const seeded = ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NotI', 'XbaI', 'PstI', 'SalI', 'NcoI', 'NdeI', 'KpnI', 'SacI']
const mcs = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'XmaI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'SphI', 'HindIII']
check('ENZYME DB has >=50 enzymes', ENZYMES.length >= 50, `${ENZYMES.length}`)
check('all seeded enzymes present in DB', seeded.every((n) => !!getEnzyme(n)), seeded.filter((n) => !getEnzyme(n)).join(',') || 'ok')
check('all MCS enzymes present in DB', mcs.every((n) => !!getEnzyme(n)), mcs.filter((n) => !getEnzyme(n)).join(',') || 'ok')

// EcoRI palindrome dedup: cut count must equal # of GAATTC occurrences (circular).
const ecoEnz = getEnzyme('EcoRI')!
const ecoExpect = circularCount(seq, 'GAATTC')
const ecoSites = findCutSites(rec, [ecoEnz])
check('EcoRI not double-counted (palindrome)', ecoSites.length === ecoExpect, `sites=${ecoSites.length} expected=${ecoExpect}`)

// Digestion invariant: fragment lengths sum to sequence length; circular N cuts -> N fragments.
const allEnz = mcs.map((n) => getEnzyme(n)!).filter(Boolean)
const sites = findCutSites(rec, allEnz)
const frags = digest(rec, allEnz)
const sumLen = frags.reduce((a, f) => a + f.length, 0)
check('digest fragment lengths sum to plasmid length', sumLen === len, `sum=${sumLen} len=${len}`)
const uniqCutPositions = new Set(sites.map((s) => s.cutPosTop)).size
check('circular: #fragments === #cut positions', frags.length === uniqCutPositions, `frags=${frags.length} cuts=${uniqCutPositions}`)
check('every fragment sequence length matches its length field', frags.every((f) => f.sequence.length === f.length))

// Report MCS cutter multiplicity (informational + soft check that each cuts >=1).
const counts = cutCounts(rec, allEnz)
const cutterReport = mcs.map((n) => `${n}:${counts.get(n) ?? 0}`).join('  ')
console.log('    cut counts → ' + cutterReport)
check('every MCS enzyme cuts at least once', mcs.every((n) => (counts.get(n) ?? 0) >= 1), cutterReport)
const uniqueCutters = mcs.filter((n) => (counts.get(n) ?? 0) === 1)
console.log(`    unique cutters among MCS: ${uniqueCutters.length}/${mcs.length} (${uniqueCutters.join(', ')})`)

// ---------------------------------------------------------------------------
section('FASTA round-trip')
const fa = serializeFasta(rec)
const faBack = parseFasta(fa)
check('FASTA preserves sequence', faBack.sequence === seq)
check('FASTA preserves name', faBack.name === rec.name, faBack.name)

// ---------------------------------------------------------------------------
section('GenBank round-trip')
let gbOk = false
try {
  const gb = serializeGenBank(rec)
  const gbBack = parseGenBank(gb)
  check('GenBank preserves sequence', gbBack.sequence === seq, `len ${gbBack.sequence.length} vs ${seq.length}`)
  check('GenBank preserves topology', gbBack.topology === rec.topology, gbBack.topology)
  check('GenBank preserves feature count', gbBack.features.length === rec.features.length, `${gbBack.features.length} vs ${rec.features.length}`)
  const allMatched = rec.features.every((f) =>
    gbBack.features.some((g) => g.type === f.type && g.start === f.start && g.end === f.end && g.strand === f.strand)
  )
  check('GenBank preserves each feature (type/coords/strand)', allMatched)
  gbOk = true
} catch (e) {
  check('GenBank round-trip did not throw', false, (e as Error).message)
}
void gbOk

// ---------------------------------------------------------------------------
section('Primers')
const tm20 = calcTm('ACGTACGTACGTACGTACGT')
check('calcTm of a 20-mer is realistic (40-80°C)', tm20 > 40 && tm20 < 80, `${tm20.toFixed(1)}°C`)
const probe = seq.slice(500, 520)
const hits = findPrimerBindingSites(rec, { id: 'p1', name: 'probe', sequence: probe }, 0)
check('exact-match primer is located (0 mismatch)', hits.some((h) => h.strand === 1 && h.start === 500), `${hits.length} hits`)
const designed = designPrimers(rec, { start: 600, end: 900 })
check('designPrimers returns a pair', !!designed && !!designed.forward.sequence && !!designed.reverse.sequence)
const ap = analyzePrimer(probe)
check('analyzePrimer reports sensible fields', ap.length === 20 && ap.tm > 0 && ap.gc >= 0)

// ---------------------------------------------------------------------------
section('Summary')
console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n\x1b[31mFAILURES:\x1b[0m')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
} else {
  console.log('\n\x1b[32mAll engine invariants hold.\x1b[0m')
}
