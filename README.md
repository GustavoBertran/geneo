# GeneO

A molecular-biology workbench for plasmid design, cloning, and sequence analysis — a SnapGene-style desktop application built with **Electron + React + TypeScript**.

GeneO opens DNA sequences (GenBank / FASTA), draws annotated circular and linear plasmid maps, and runs real molecular-biology analyses entirely offline: restriction digestion, ORF finding & translation, and primer design / PCR simulation.

The app ships with the real **pUC19** cloning vector (GenBank L09137) loaded by default — its annotations (AmpR/bla, lacZα, the multiple cloning site) are derived live by GeneO's own ORF finder, and the engines correctly reproduce pUC19's textbook biology: all ten MCS enzymes are unique cutters, and the longest ORF translates to the authentic TEM-1 β-lactamase protein.

## Features

**Map views**
- **Circular map** — the signature plasmid view: backbone with bp ruler, directional feature arcs stacked on concentric lanes, enzyme cut-site labels with leader lines, and a live selection arc.
- **Linear map** — horizontal map with forward/reverse feature lanes, enzyme ticks, zoom (1×/2×/4×), and drag-to-select.

**Sequence editor**
- Color-coded bases, complement strand, and toggleable reading-frame translation tracks.
- Feature highlight bars, enzyme cut carets, click-and-drag base selection, "go to position", and "new feature from selection".

**Restriction & cloning**
- A 60-enzyme database (Type II + a few Type IIS) with IUPAC-aware site finding, palindrome de-duplication, and origin-spanning (circular) cut detection.
- Filter by cut count (unique / double / non-cutters), a digest fragment table, and a virtual agarose **gel** with ladder.

**ORFs & translation**
- Six-frame translation map with stop-codon ticks, ORF table (length, MW, protein), and one-click "annotate as CDS".
- Standard genetic code, circular wrapping ORFs handled correctly.

**Primers & PCR**
- Oligo analysis: nearest-neighbor **Tm** (SantaLucia 1998), GC%, 3′ clamp, hairpin / self-dimer detection, and design warnings.
- Binding-site search, primer design for a selected region, and full PCR product simulation (circular-aware).

**Genome browser** (UCSC-style)
- A chromosome-scale, multi-track viewer separate from the plasmid tools. Ships with the real human **TP53 locus** (Ensembl GRCh38 chr17): all GENCODE isoforms with exon/intron structure, thick-CDS / thin-UTR gene glyphs, and strand arrows (TP53 minus-strand arrows point left; WRAP53 plus-strand point right).
- Tracks: gene models, generic interval features (BED), a quantitative signal track (GC percent / bedGraph / WIG, aggregated to pixel columns), and a zoom-gated reference-sequence track that renders colored bases only when legible.
- Navigation: locus box (`chr17:7,668,000-7,688,000`), gene-name search, zoom/pan buttons, drag-to-pan, scroll-to-zoom, per-track visibility.
- **Position markers** (karyoploteR-style): add a labeled vertical rule at any coordinate (`7,668,421` or `chr17:7,668,421`); markers span every track and are removable from chips.
- **Export snapshot**: export the current view as **PNG** or **SVG** (composed from the live track SVGs with CSS variables resolved; PNG written via a native save dialog), filename defaults to the locus. Markers are included in the export.
- Load your own **GFF3 / GTF, BED (3–12 col), bedGraph / WIG, and FASTA** tracks. Chromosome names are normalized so `17` / `chr17` reconcile across files.

**File I/O**
- GenBank import/export (locations incl. `complement()` / `join()`, qualifiers, origin-wrap) and FASTA import/export, via native Open/Save dialogs.

## Architecture

```
src/
  main/        Electron main process (window + file open/save/save-image IPC, production CSP)
  preload/     contextBridge API (window.api.openFile / saveFile / saveImage)
  renderer/
    src/
      core/        pure, UI-free plasmid engines:
                     sequence.ts   shared primitives (revcomp, subsequence, GC, IUPAC…)
                     types.ts      domain types + the coordinate convention
                     enzymes.ts    restriction site finding + digestion (+ data/enzymes.ts DB)
                     translation.ts genetic code, 6-frame translation, ORF finding
                     primers.ts    Tm, primer analysis, binding sites, PCR, design
                     genbank.ts / fasta.ts / io.ts   parsers & serializers
      genome/      genome-browser subsystem (chromosome scale):
                     types.ts      assembly / chromosome / track / transcript model + render contract
                     viewport.ts   locus clamp, bp<->px scale, ticks, chrom-name normalize
                     gff.ts / bed.ts / wig.ts   GFF3-GTF / BED / bedGraph-WIG parsers
                     signal.ts     GC-percent signal from reference; io.ts file dispatch
                     export.ts     compose live track SVGs -> snapshot SVG/PNG
      state/       Zustand store (single source of truth — plasmid + genome)
      hooks/       memoized derived selectors (useCutSites, useOrfs, …)
      components/  plasmid views (CircularMap, LinearMap, SequenceView, *Panel) + shell
      components/genome/  GenomeBrowser + GeneTrack / FeatureTrack / SignalTrack / SequenceTrack
      data/        bundled samples (real pUC19, real TP53 genome locus, synthetic demo)
```

**Coordinate convention** (everywhere): 0-based, half-open `[start, end)`; strand `1` = top / `-1` = bottom; circular features wrap the origin when `start > end`.

The `core/` engines are pure functions with no UI dependencies, which is what makes the numeric verification below possible.

## Develop & run

```bash
npm install

npm run dev        # launch the Electron desktop app (hot reload)
npm run web        # run the renderer in a plain browser (fast UI iteration)
npm run build      # production build (main + preload + renderer)
```

## Install as a desktop app

Package GeneO into a standalone macOS `.app` you can keep in the Dock:

```bash
npm run package:mac   # → dist/mac-arm64/GeneO.app
```

Then drag `GeneO.app` to `/Applications`, open it once, and right-click its Dock
icon → Options → Keep in Dock. (electron-builder config lives in the `build`
field of `package.json`; the icon is generated from `build/icon.png`. asar is
disabled to avoid an integrity-hash bug in electron-builder 25.)

## Quality gates

```bash
npm run typecheck      # strict TypeScript across main, preload, and renderer
npm run verify         # numeric engine assertions against the sample plasmids
npm run verify:genome  # genome-parser assertions against the real TP53 region
```

`npm run verify` checks invariants that a typecheck cannot — e.g. digest fragment
lengths sum to the plasmid length, restriction palindromes aren't double-counted,
CDS features translate with no internal stop codons, GenBank/FASTA round-trip
losslessly, and primer Tm lands in a realistic range.

`npm run verify:genome` exercises the whole GFF parse → group → multi-parent
exon → strand → coordinate chain by assembling the canonical TP53 CDS from the
real Ensembl annotation and translating it: it must yield the authentic p53
protein (`MEEPQSDPSV…`), start with Met, contain no internal stops, and end with
a stop codon.

## Notes

- Built to be Electron-first; the renderer is a standard Vite React app, so it also runs in a browser (file Open/Save require the Electron shell).
- No network access at runtime — all analysis runs locally.
