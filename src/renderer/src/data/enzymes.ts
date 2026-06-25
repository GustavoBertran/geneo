/**
 * Restriction-enzyme database for GeneO.
 *
 * Each entry follows the coordinate convention in core/types.ts:
 *   - `site` is the recognition sequence 5'->3' on the top strand (IUPAC allowed).
 *   - `cutTop`    = 0-based offset from the first base of the site after which
 *                   the TOP strand is cut.
 *   - `cutBottom` = 0-based offset (along the top-strand coordinate) after which
 *                   the BOTTOM strand is cut.
 *   - `overhang`  = "5'" | "3'" | 'blunt' (derived from cutTop vs cutBottom but
 *                   stored explicitly for convenience / display).
 *
 * Cut values are verified against REBASE. For Type IIS enzymes the cut is
 * OUTSIDE the recognition site; the same offset-from-first-base convention holds
 * so the offsets exceed the site length.
 */
import type { Enzyme } from '../core/types'

export const ENZYME_DATA: Enzyme[] = [
  // --- 5' overhang, palindromic 6-cutters (G^AATTC style) ---
  { name: 'EcoRI', site: 'GAATTC', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'BamHI', site: 'GGATCC', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'HindIII', site: 'AAGCTT', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'XhoI', site: 'CTCGAG', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'SalI', site: 'GTCGAC', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'XbaI', site: 'TCTAGA', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'NheI', site: 'GCTAGC', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'SpeI', site: 'ACTAGT', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'BglII', site: 'AGATCT', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'NcoI', site: 'CCATGG', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'XmaI', site: 'CCCGGG', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'MfeI', site: 'CAATTG', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'AvrII', site: 'CCTAGG', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'AgeI', site: 'ACCGGT', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'BspEI', site: 'TCCGGA', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'MluI', site: 'ACGCGT', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'AflII', site: 'CTTAAG', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'BsrGI', site: 'TGTACA', cutTop: 1, cutBottom: 5, overhang: "5'" },
  { name: 'EagI', site: 'CGGCCG', cutTop: 1, cutBottom: 5, overhang: "5'" },

  // --- 5' overhang, palindromic 8-cutters ---
  { name: 'NotI', site: 'GCGGCCGC', cutTop: 2, cutBottom: 6, overhang: "5'" },
  { name: 'AscI', site: 'GGCGCGCC', cutTop: 2, cutBottom: 6, overhang: "5'" },

  // --- 5' overhang, 2-base offset 6-cutters ---
  { name: 'NdeI', site: 'CATATG', cutTop: 2, cutBottom: 4, overhang: "5'" },
  { name: 'ClaI', site: 'ATCGAT', cutTop: 2, cutBottom: 4, overhang: "5'" },
  { name: 'AclI', site: 'AACGTT', cutTop: 2, cutBottom: 4, overhang: "5'" },

  // --- blunt cutters ---
  { name: 'SmaI', site: 'CCCGGG', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'EcoRV', site: 'GATATC', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'PvuII', site: 'CAGCTG', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'ScaI', site: 'AGTACT', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'StuI', site: 'AGGCCT', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'HpaI', site: 'GTTAAC', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'DraI', site: 'TTTAAA', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'SspI', site: 'AATATT', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'NruI', site: 'TCGCGA', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'SnaBI', site: 'TACGTA', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'PmeI', site: 'GTTTAAAC', cutTop: 4, cutBottom: 4, overhang: 'blunt' },
  { name: 'SwaI', site: 'ATTTAAAT', cutTop: 4, cutBottom: 4, overhang: 'blunt' },
  { name: 'AfeI', site: 'AGCGCT', cutTop: 3, cutBottom: 3, overhang: 'blunt' },
  { name: 'BsaAI', site: 'YACGTR', cutTop: 3, cutBottom: 3, overhang: 'blunt' },

  // --- 3' overhang 6-cutters (CTGCA^G style) ---
  { name: 'PstI', site: 'CTGCAG', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'SphI', site: 'GCATGC', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'SacI', site: 'GAGCTC', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'KpnI', site: 'GGTACC', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'NsiI', site: 'ATGCAT', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'ApaI', site: 'GGGCCC', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'AatII', site: 'GACGTC', cutTop: 5, cutBottom: 1, overhang: "3'" },
  { name: 'PvuI', site: 'CGATCG', cutTop: 4, cutBottom: 2, overhang: "3'" },
  { name: 'SacII', site: 'CCGCGG', cutTop: 4, cutBottom: 2, overhang: "3'" },
  { name: 'BsiWI', site: 'CGTACG', cutTop: 1, cutBottom: 5, overhang: "5'" },

  // --- 3' overhang 8-cutters ---
  { name: 'SbfI', site: 'CCTGCAGG', cutTop: 6, cutBottom: 2, overhang: "3'" },
  { name: 'FseI', site: 'GGCCGGCC', cutTop: 6, cutBottom: 2, overhang: "3'" },
  { name: 'PacI', site: 'TTAATTAA', cutTop: 5, cutBottom: 3, overhang: "3'" },

  // --- IUPAC-ambiguous interrupted-palindrome cutters ---
  { name: 'BstEII', site: 'GGTNACC', cutTop: 1, cutBottom: 6, overhang: "5'" },
  { name: 'DraIII', site: 'CACNNNGTG', cutTop: 6, cutBottom: 3, overhang: "3'" },
  { name: 'BstXI', site: 'CCANNNNNNTGG', cutTop: 8, cutBottom: 4, overhang: "3'" },
  { name: 'XcmI', site: 'CCANNNNNNNNNTGG', cutTop: 8, cutBottom: 7, overhang: "3'" },
  { name: 'AlwNI', site: 'CAGNNNCTG', cutTop: 6, cutBottom: 3, overhang: "3'" },
  { name: 'BglI', site: 'GCCNNNNNGGC', cutTop: 7, cutBottom: 4, overhang: "3'" },

  // --- Type IIS (cut outside recognition site) ---
  { name: 'BsaI', site: 'GGTCTC', cutTop: 7, cutBottom: 11, overhang: "5'" },
  { name: 'BbsI', site: 'GAAGAC', cutTop: 8, cutBottom: 12, overhang: "5'" },
  { name: 'BsmBI', site: 'CGTCTC', cutTop: 7, cutBottom: 11, overhang: "5'" }
]
