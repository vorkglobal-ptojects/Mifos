// Canonical Branch IDs matching public.branches table in Supabase
export const CANONICAL_BRANCHES = [
  { id: 'HQ',   name: 'Head Office' },
  { id: 'DHW',  name: 'Dehiwala' },
  { id: 'KHT',  name: 'Kahathuduwa' },
  { id: 'KTW',  name: 'Kottawa' },
  { id: 'KOT',  name: 'Kotikawatta' },
  { id: 'PND',  name: 'Panadura' },
  { id: 'BRL',  name: 'Borella' },
  { id: 'DMT',  name: 'Dematagoda' },
  { id: 'HMG',  name: 'Homagama' },
  { id: 'KDW',  name: 'Kadawatha' },
  { id: 'KIR',  name: 'Kiribathgoda' },
  { id: 'W2',   name: 'Wattala 2' },
  { id: 'W3',   name: 'Wattala 3' },
  { id: 'W4',   name: 'Wattala 4' },
  { id: 'TEST', name: 'Test Branch' },
] as const;

// Normalization map from any alias / UI value to canonical database branch_id
const BRANCH_ALIAS_MAP: Record<string, string> = {
  // Test Branch
  'TEST': 'TEST',
  'TESTBRANCH': 'TEST',
  'TEST BRANCH': 'TEST',

  // Kahathuduwa
  'KAH': 'KHT',
  'KHT': 'KHT',
  'KAHATHUDUWA': 'KHT',
  'KAHATHOTUWA': 'KHT',
  'KAHATHUTUWA': 'KHT',

  // Panadura
  'PAN': 'PND',
  'PND': 'PND',
  'PANADURA': 'PND',

  // Dematagoda
  'DEM': 'DMT',
  'DMT': 'DMT',
  'DEMATAGODA': 'DMT',
  'DEMOTAGODA': 'DMT',

  // Borella
  'BOR': 'BRL',
  'BRL': 'BRL',
  'BORELLA': 'BRL',

  // Kadawatha
  'KAD': 'KDW',
  'KDW': 'KDW',
  'KADAWATHA': 'KDW',
  'KADAWATTA': 'KDW',

  // Kottawa
  'KTW': 'KTW',
  'KOTTAWA': 'KTW',

  // Kotikawatta
  'KOT': 'KOT',
  'KOTIKAWATTA': 'KOT',

  // Homagama
  'HOM': 'HMG',
  'HMG': 'HMG',
  'HOMAGAMA': 'HMG',

  // Kiribathgoda
  'KIR': 'KIR',
  'KIR1': 'KIR',
  'KIR2': 'KIR',
  'KIRIBATHGODA': 'KIR',

  // Wattala
  'WAT2': 'W2',
  'W2': 'W2',
  'WAT3': 'W3',
  'W3': 'W3',
  'WAT4': 'W4',
  'W4': 'W4',

  // Dehiwala / Main Branch
  'DHW': 'DHW',
  'DEHIWALA': 'DHW',
  'MAIN': 'DHW',
  'MAIN BRANCH': 'DHW',
  'MAINBRANCH': 'DHW',

  // HQ
  'HQ': 'HQ',
  'HEAD OFFICE': 'HQ',
};

/**
 * Normalizes any branch code / alias / name to its canonical DB branch_id (e.g. 'KAH' -> 'KHT')
 */
export function normalizeBranchId(branchId: string | null | undefined): string {
  if (!branchId) return 'HQ';
  const clean = branchId.trim().toUpperCase();
  return BRANCH_ALIAS_MAP[clean] || clean;
}

/**
 * Returns all potential aliases for a given branch to ensure backward-compatible DB searches
 */
export function getBranchSearchTerms(branchId: string | null | undefined): string[] {
  const norm = normalizeBranchId(branchId);
  const terms = new Set<string>([norm]);
  if (branchId) terms.add(branchId.trim().toUpperCase());

  if (norm === 'KHT') {
    terms.add('KAH');
    terms.add('Kahathuduwa');
    terms.add('Kahathotuwa');
  } else if (norm === 'DHW') {
    terms.add('DEHIWALA');
    terms.add('Dehiwala');
  } else if (norm === 'PND') {
    terms.add('PAN');
    terms.add('Panadura');
  } else if (norm === 'DMT') {
    terms.add('DEM');
    terms.add('Dematagoda');
  } else if (norm === 'BRL') {
    terms.add('BOR');
    terms.add('Borella');
  } else if (norm === 'KDW') {
    terms.add('KAD');
    terms.add('Kadawatha');
  } else if (norm === 'KTW') {
    terms.add('Kottawa');
  } else if (norm === 'KOT') {
    terms.add('Kotikawatta');
  } else if (norm === 'HMG') {
    terms.add('HOM');
    terms.add('Homagama');
  } else if (norm === 'KIR') {
    terms.add('Kiribathgoda');
  } else if (norm === 'W4') {
    terms.add('WAT4');
  } else if (norm === 'W3') {
    terms.add('WAT3');
  } else if (norm === 'W2') {
    terms.add('WAT2');
  } else if (norm === 'TEST') {
    terms.add('TESTBRANCH');
    terms.add('testbranch');
    terms.add('Test Branch');
  }

  return Array.from(terms);
}

/**
 * Normalizes an NIC to its canonical uppercase, space-stripped format.
 * - Old format: e.g. "755381128 v" or "755381128-V" -> "755381128V"
 * - New format: e.g. "1985 1234 5678" -> "198512345678"
 * - Prefixed format: e.g. "KTW-755381128 v" -> "755381128V"
 */
export function normalizeNationalId(id: string | null | undefined): string {
  if (!id) return '';
  const stripped = stripBranchPrefix(id).trim();
  // Remove all internal spaces, dashes, dots, underscores, slashes
  const clean = stripped.replace(/[\s\-._/]+/g, '');
  if (/^[0-9]{9}[vVxX]$/.test(clean)) {
    return clean.toUpperCase();
  }
  if (/^[0-9]{12}$/.test(clean)) {
    return clean;
  }
  // 9 numeric digits where user omitted the 'V' letter (e.g. 727501843)
  if (/^[0-9]{9}$/.test(clean)) {
    return `${clean}V`;
  }
  if (/^[0-9]{8}[vVxX]$/.test(clean)) {
    return clean.toUpperCase();
  }
  return stripped;
}

/**
 * Checks if an identifier matches official Sri Lankan National Identity Card (NIC) formats:
 * - Old format: 9 digits followed by 'V' or 'X' (e.g. 851234567V, "851234567 v", "851234567-V")
 * - 9 digits numeric (teller omitted V/X, e.g. 727501843)
 * - New format: 12 numeric digits (e.g. 198512345678, "1985 1234 5678")
 * - 8 digits + V/X typo allowance
 */
export function isNationalId(id: string | null | undefined): boolean {
  if (!id) return false;
  const stripped = stripBranchPrefix(id).trim();
  const clean = stripped.replace(/[\s\-._/]+/g, '');
  return /^[0-9]{9}[vVxX]?$/.test(clean) || /^[0-9]{12}$/.test(clean) || /^[0-9]{8}[vVxX]$/.test(clean);
}

/**
 * Strips any leading branch prefix (e.g. "KDW-3R 14543" -> "3R 14543", "KIR/3R 14543" -> "3R 14543")
 * so UI and printed receipts always display the original clean ticket / account number.
 */
export function stripBranchPrefix(idOrBill: string | null | undefined): string {
  if (!idOrBill) return '';
  const clean = idOrBill.trim();
  
  // Check if string starts with any known canonical branch code or alias followed by - or /
  const prefixMatch = clean.match(/^([A-Za-z0-9]{2,4})[-/_]\s*(.+)$/);
  if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
    const candidateCode = prefixMatch[1].toUpperCase();
    if (BRANCH_ALIAS_MAP[candidateCode] || CANONICAL_BRANCHES.some(b => b.id === candidateCode)) {
      return prefixMatch[2].trim();
    }
  }
  return clean;
}

/**
 * Formats a client ID / NIC with branch scoping behind the scenes:
 * - Real Sri Lankan NICs are left un-prefixed (they are universally unique to a citizen).
 * - Book-era account numbers, ticket IDs, or non-NIC codes (like "3R 14543", "14543", "1R 102")
 *   are automatically prefixed with the branch code (e.g. "KDW-3R 14543" or "KIR-3R 14543").
 */
export function formatBranchScopedId(id: string | null | undefined, branchId: string | null | undefined): string {
  if (!id) return '';
  const clean = id.trim();
  if (!clean) return '';
  
  // Real National ID cards are globally unique per person
  if (isNationalId(clean)) {
    return normalizeNationalId(clean);
  }

  const normBranch = normalizeBranchId(branchId);
  const stripped = stripBranchPrefix(clean);
  return `${normBranch}-${stripped}`;
}

/**
 * Formats a Pawn Ticket / Bill Number strictly clean without any branch prefix
 * (e.g. "3R 14543") as required throughout the system.
 */
export function formatBranchScopedBillNo(billNo: string | null | undefined, _branchId?: string | null | undefined): string {
  if (!billNo) return '';
  return stripBranchPrefix(billNo).trim();
}

/**
 * Formats bill number for human display (returns clean "3R 14543" without branch prefix)
 */
export function getBillDisplayNumber(billNo: string | null | undefined): string {
  return stripBranchPrefix(billNo);
}

/**
 * Extracts the numeric sequence from a bill number regardless of branch or loan prefix
 * (e.g. "12R 1234" -> "1234", "6R 1234" -> "1234", "KDW-3R 14543" -> "14543", "3R31472" -> "31472")
 */
export function extractNumericBillNo(billNo: string | null | undefined): string {
  if (!billNo) return '';
  const clean = stripBranchPrefix(billNo).trim();
  if (!clean) return '';
  // Match optional prefix ending with a letter, optional separators, then the bill digits
  const match = clean.match(/^([0-9]*[A-Za-z]+[-/_:]*)?\s*(\d+)/);
  if (match && match[2]) {
    return match[2].trim();
  }
  const fallback = clean.match(/\d+/);
  return fallback ? fallback[0] : '';
}

/**
 * Checks if two bill numbers share the same numeric part, regardless of their prefixes.
 * (e.g. "12R 1234" and "6R 1234" -> true)
 */
export function isSameNumericBill(billA: string | null | undefined, billB: string | null | undefined): boolean {
  const numA = extractNumericBillNo(billA);
  const numB = extractNumericBillNo(billB);
  if (!numA || !numB) return false;
  if (numA === numB) return true;
  // Also treat '0001' and '1' as identical numeric bills (ignore leading zeroes)
  const normA = numA.replace(/^0+/, '') || '0';
  const normB = numB.replace(/^0+/, '') || '0';
  return normA === normB;
}
