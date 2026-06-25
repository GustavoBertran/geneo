/**
 * Genome-parser verification against the real Ensembl TP53 region.
 * Exercises the whole GFF parse -> group -> multi-parent exon -> strand ->
 * 1-based conversion chain by assembling a TP53 CDS and translating it.
 *
 * Run: npx vite-node scripts/verify-genome.ts   (after the GFF parser lands)
 */
import { readFileSync } from 'fs'
import { parseGff } from '@/genome/gff'
import { parseBed } from '@/genome/bed'
import { parseBedGraph } from '@/genome/wig'
import { reverseComplement } from '@core/sequence'
import { translate } from '@core/translation'

let passed = 0
let failed = 0
const fails: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; fails.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const gffText = readFileSync('scripts/fixtures/tp53.gff3', 'utf-8')
const faText = readFileSync('scripts/fixtures/tp53.fa', 'utf-8')

// Reference window: header ">chromosome:GRCh38:17:7660000:7700000:1" (1-based).
const winStart0 = 7660000 - 1
const bases = faText.slice(faText.indexOf('\n') + 1).replace(/[^A-Za-z]/g, '').toUpperCase()

console.log(`\n\x1b[1mTP53 region: ${bases.length} bp reference window from chr17:${winStart0 + 1}\x1b[0m`)

const transcripts = parseGff(gffText)
console.log(`  parsed ${transcripts.length} transcripts`)

// --- TP53 gene model assertions ---
const tp53 = transcripts.filter((t) => (t.geneName ?? '').toUpperCase() === 'TP53')
check('TP53 transcripts present', tp53.length > 1, `${tp53.length}`)
check('TP53 is on the minus strand', tp53.every((t) => t.strand === -1))
check('TP53 chrom normalized to chr17', tp53.every((t) => t.chrom === 'chr17'))
check('every TP53 transcript has exons', tp53.every((t) => t.exons.length > 0))
check('exons lie within their transcript bounds', tp53.every((t) =>
  t.exons.every((e) => e.start >= t.start && e.end <= t.end)))
check('WRAP53 also parsed', transcripts.some((t) => (t.geneName ?? '').toUpperCase() === 'WRAP53'))

// --- The decisive check: assemble a TP53 CDS and translate it. ---
function windowSlice(s: number, e: number): string {
  const a = Math.max(0, s - winStart0)
  const b = Math.min(bases.length, e - winStart0)
  return b > a ? bases.slice(a, b) : ''
}

// canonical = protein-coding TP53 transcript with the longest assembled CDS that
// is fully inside the sequence window.
const coding = tp53
  .filter((t) => t.cds.length > 0 && t.cds[0].start >= winStart0 && t.cds[t.cds.length - 1].end <= bases.length + winStart0)
  .map((t) => {
    const blocks = [...t.cds].sort((a, b) => a.start - b.start)
    let plus = ''
    for (const c of blocks) plus += windowSlice(c.start, c.end)
    const coding = t.strand === -1 ? reverseComplement(plus) : plus
    return { t, coding, protein: translate(coding) }
  })
  .sort((a, b) => b.coding.length - a.coding.length)

const best = coding[0]
if (!best) {
  check('a TP53 CDS could be assembled', false)
} else {
  const prot = best.protein
  console.log(`  canonical TP53 CDS: ${best.t.name}  ${best.coding.length} nt  ${prot.length} aa`)
  console.log(`  protein starts: ${prot.slice(0, 16)}…`)
  check('CDS length is a multiple of 3', best.coding.length % 3 === 0, `${best.coding.length}`)
  check('TP53 protein starts with Met (M)', prot.startsWith('M'))
  check('TP53 protein has no internal stop codons', !prot.slice(0, -1).includes('*'))
  check('TP53 protein ends with a stop codon', prot.endsWith('*'))
  // cherry: canonical p53 begins MEEPQSDPSV
  if (prot.startsWith('MEEPQSDP')) console.log('  \x1b[32m✓ matches canonical p53 N-terminus MEEPQSDP…\x1b[0m')
}

// --- BED + bedGraph smoke tests ---
const bed = parseBed('chr17\t7668000\t7669000\tregionA\t500\t-\t7668100\t7668900\t255,0,0\t2\t200,300\t0,700\n')
check('parseBed reads a BED12 line', bed.length === 1 && (bed[0].blocks?.length ?? 0) === 2, JSON.stringify(bed[0]?.blocks))
check('parseBed coords are 0-based (no off-by-one)', bed[0]?.start === 7668000 && bed[0]?.end === 7669000)

const bg = parseBedGraph('chr17 7660000 7660100 0.8\nchr17 7660100 7660200 0.4\n')
check('parseBedGraph reads spans', bg.spans.length === 2 && bg.chrom === 'chr17')
check('parseBedGraph computes min/max', bg.min === 0.4 && bg.max === 0.8)

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) { console.log('\n\x1b[31mFAILURES:\x1b[0m'); for (const f of fails) console.log('  - ' + f); process.exit(1) }
else console.log('\n\x1b[32mGenome parsers verified on real TP53 data.\x1b[0m')
