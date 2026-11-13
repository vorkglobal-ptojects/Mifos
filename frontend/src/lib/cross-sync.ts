import { adminSupabase } from './auth-server';
import { recordAuditLog } from './audit-logger';
import {
  normalizeBranchId,
  getBranchSearchTerms,
  stripBranchPrefix,
  formatBranchScopedBillNo,
  normalizeNationalId,
  extractNumericBillNo,
  generateUniqueOrderTag,
} from './branch-mapping';
import { getSriLankaDate } from './date-utils';
import { invalidateBranchInventoryCache } from './redis';
import { invalidateClientsCache } from '@/app/api/clients/route';

export const CUSTOMER_DELETE_BLOCK_MESSAGE =
  'Customer deletion is permanently disabled to protect KYC, pawning, and stock audit history.';

const DUMMY_NICS = new Set([
  '0', '00', '000', '0000', '-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', '.', ''
]);

function isDummyOrPendingNic(nic?: string | null): boolean {
  const s = String(nic || '').trim();
  if (!s) return true;
  if (DUMMY_NICS.has(s.toUpperCase())) return true;
  if (/^0+$/.test(s)) return true;
  if (s.toUpperCase().startsWith('PENDING-')) return true;
  return !/[A-Za-z0-9]/.test(s);
}

/**
 * Parses a bill number into its normalized components so e.g. "3R 0167" matches
 * "KHT-3R 0167", "3R0167", and "3R 167", WITHOUT falsely colliding "1R 0167" with "3R 0167".
 */
function parseBillSignature(raw?: string | null): {
  stripped: string;
  compact: string;
  prefix: string;
  digits: string;
  trimmedDigits: string;
} {
  const stripped = stripBranchPrefix(String(raw || '')).trim().replace(/\s+/g, ' ');
  const compact = stripped.toLowerCase().replace(/[^a-z0-9]/g, '');
  const m = stripped.match(/^([0-9]*[A-Za-z]+)[-\s]*(\d+.*)$/);
  if (m) {
    const prefix = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    const digits = extractNumericBillNo(m[2]);
    return {
      stripped,
      compact,
      prefix,
      digits,
      trimmedDigits: digits.replace(/^0+/, '') || '0',
    };
  }
  const digits = extractNumericBillNo(stripped);
  return {
    stripped,
    compact,
    prefix: '',
    digits,
    trimmedDigits: digits.replace(/^0+/, '') || '0',
  };
}

/**
 * Safe branch-local bill matcher that distinguishes tenor prefixes (1R vs 3R vs 12R).
 */
export function isSameBranchBill(a?: string | null, b?: string | null): boolean {
  const sa = parseBillSignature(a);
  const sb = parseBillSignature(b);
  if (!sa.compact || !sb.compact) return false;
  if (sa.compact === sb.compact) return true;
  if (sa.digits && sb.digits && sa.prefix && sb.prefix) {
    return sa.prefix === sb.prefix && sa.trimmedDigits === sb.trimmedDigits;
  }
  if (!sa.prefix && !sb.prefix && sa.digits && sb.digits) {
    return sa.trimmedDigits === sb.trimmedDigits;
  }
  return false;
}

/**
 * Generates deduplicated YYYY-MM-DD date candidates covering Colombo local time and raw ISO slice.
 */
export function buildLedgerDateCandidates(rawDate?: string | null): string[] {
  const set = new Set<string>();
  const trimmed = String(rawDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    set.add(trimmed);
  } else if (trimmed) {
    const sl = getSriLankaDate(trimmed);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sl)) set.add(sl);
    const iso = trimmed.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) set.add(iso);
  }
  return Array.from(set);
}

function shiftDateDays(ymd: string, deltaDays: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function splitFullName(fullName?: string | null): { first_name: string; last_name: string } {
  const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { first_name: 'Valued Customer', last_name: '.' };
  return { first_name: cleaned, last_name: '.' };
}

function buildFullName(firstName?: string | null, lastName?: string | null): string {
  const f = String(firstName || '').trim();
  const l = String(lastName || '').trim();
  if (!f && (!l || l === '.')) return '';
  if (!l || l === '.') return f;
  return `${f} ${l}`.trim();
}

function isUUID(str?: string | null): boolean {
  return (
    typeof str === 'string' &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str)
  );
}

async function invalidateCachesForBranch(branchId?: string | null): Promise<void> {
  try {
    invalidateClientsCache();
  } catch {}
  const b = normalizeBranchId(branchId || '');
  if (b && b !== 'ALL') {
    await invalidateBranchInventoryCache(b);
  } else {
    await invalidateBranchInventoryCache('ALL');
  }
}

/**
 * Syncs edits on `clients` to matching same-branch `stock_customers`, recalculates
 * `pawns.unique_tag` when NIC changes, and invalidates caches.
 */
export async function syncClientAcrossModules(params: {
  clientId?: string;
  branchId?: string;
  oldNationalId?: string;
  newNationalId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  oldPhone?: string;
  oldName?: string;
  addBillNo?: string;
}): Promise<void> {
  try {
    let clientRow: any = null;
    if (params.clientId) {
      const { data } = await adminSupabase
        .from('clients')
        .select('*')
        .eq('id', params.clientId)
        .maybeSingle();
      clientRow = data;
    }

    const effectiveBranch = normalizeBranchId(
      params.branchId || clientRow?.branch_id || 'HQ'
    );
    const branchTerms = getBranchSearchTerms(effectiveBranch);

    const oldNic = String(params.oldNationalId || clientRow?.national_id || '').trim();
    const newNic = String(params.newNationalId || clientRow?.national_id || '').trim();
    const finalFirst =
      params.firstName !== undefined
        ? params.firstName
        : clientRow?.first_name || clientRow?.firstName || '';
    const finalLast =
      params.lastName !== undefined
        ? params.lastName
        : clientRow?.last_name || clientRow?.lastName || '.';
    const fullName = buildFullName(finalFirst, finalLast);
    const finalPhone =
      params.phone !== undefined ? params.phone : clientRow?.phone || '';
    const finalAddress =
      params.address !== undefined ? params.address : clientRow?.address || '';

    // 1. Update matching stock_customers strictly inside the same branch
    const { data: branchStockCusts } = await adminSupabase
      .from('stock_customers')
      .select('id, name, address, tp, nic, bill_numbers, branch_id')
      .in('branch_id', branchTerms);

    const nicCandidates = new Set<string>();
    if (!isDummyOrPendingNic(oldNic)) {
      nicCandidates.add(normalizeNationalId(oldNic).toUpperCase());
      nicCandidates.add(oldNic.toUpperCase());
    }
    if (!isDummyOrPendingNic(newNic)) {
      nicCandidates.add(normalizeNationalId(newNic).toUpperCase());
      nicCandidates.add(newNic.toUpperCase());
    }

    const cleanOldPhone = String(params.oldPhone || finalPhone || '').replace(/\D/g, '');
    const cleanOldName = String(params.oldName || fullName || '').trim().toLowerCase();

    let pawnBillList: string[] = [];
    if (params.clientId || !isDummyOrPendingNic(oldNic)) {
      let pq = adminSupabase
        .from('pawns')
        .select('id, bill_no, client_id, unique_tag, branch_id')
        .in('branch_id', branchTerms);
      if (params.clientId) {
        pq = pq.eq('client_id', params.clientId);
      } else {
        pq = pq.ilike('client_id', oldNic);
      }
      const { data: clientPawns } = await pq;
      pawnBillList = (clientPawns || [])
        .map((p: any) => String(p.bill_no || '').trim())
        .filter(Boolean);

      // Keep pawns.unique_tag synchronized if NIC changed
      if (newNic && oldNic && normalizeNationalId(oldNic) !== normalizeNationalId(newNic)) {
        const cleanTagNic = isDummyOrPendingNic(newNic) ? '' : normalizeNationalId(newNic);
        for (const p of clientPawns || []) {
          const nextTag = cleanTagNic
            ? generateUniqueOrderTag(effectiveBranch, cleanTagNic, p.bill_no || p.id)
            : p.unique_tag;
          if (nextTag && nextTag !== p.unique_tag) {
            await adminSupabase
              .from('pawns')
              .update({ unique_tag: nextTag })
              .eq('id', p.id);
          }
        }
      }
    }

    const expectedShortBills = Array.from(
      new Set(
        [
          ...pawnBillList.map((b) => stripBranchPrefix(b).trim()),
          ...(params.addBillNo ? [stripBranchPrefix(params.addBillNo).trim()] : []),
        ].filter(Boolean)
      )
    );

    let matchedAnyStockCustomer = false;
    if (branchStockCusts && branchStockCusts.length > 0) {
      for (const sc of branchStockCusts) {
        const scNicNorm = !isDummyOrPendingNic(sc.nic)
          ? normalizeNationalId(sc.nic).toUpperCase()
          : '';
        const matchesByNic =
          nicCandidates.size > 0 &&
          (nicCandidates.has(scNicNorm) || nicCandidates.has(String(sc.nic || '').trim().toUpperCase()));

        const scBills = String(sc.bill_numbers || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const matchesByBill =
          pawnBillList.length > 0 &&
          scBills.some((sb) => pawnBillList.some((pb) => isSameBranchBill(sb, pb)));

        const scPhoneClean = String(sc.tp || '').replace(/\D/g, '');
        const scNameClean = String(sc.name || '').trim().toLowerCase();
        const matchesByPhoneAndName =
          cleanOldPhone.length >= 9 &&
          cleanOldName.length > 1 &&
          scPhoneClean === cleanOldPhone &&
          scNameClean === cleanOldName;

        if (matchesByNic || matchesByBill || matchesByPhoneAndName) {
          matchedAnyStockCustomer = true;
          const scUpdates: Record<string, any> = {};
          if (fullName) scUpdates.name = fullName;
          if (finalPhone !== undefined && String(finalPhone).trim() !== '') {
            scUpdates.tp = String(finalPhone).trim();
          }
          if (finalAddress !== undefined && String(finalAddress).trim() !== '') {
            scUpdates.address = String(finalAddress).trim();
          }
          if (!isDummyOrPendingNic(newNic)) {
            scUpdates.nic = normalizeNationalId(newNic);
          }
          const missingBills = expectedShortBills.filter(
            (eb) => !scBills.some((sb) => isSameBranchBill(sb, eb))
          );
          if (missingBills.length > 0) {
            scUpdates.bill_numbers = Array.from(new Set([...scBills, ...missingBills])).join(', ');
          }
          if (Object.keys(scUpdates).length > 0) {
            await adminSupabase
              .from('stock_customers')
              .update(scUpdates)
              .eq('id', sc.id);
          }
        }
      }
    }

    if (
      !matchedAnyStockCustomer &&
      fullName &&
      (!isDummyOrPendingNic(newNic) || expectedShortBills.length > 0)
    ) {
      await adminSupabase.from('stock_customers').insert([{
        name: fullName,
        address: (finalAddress && String(finalAddress).trim()) || '-',
        tp: (finalPhone && String(finalPhone).trim()) || 'N/A',
        nic: !isDummyOrPendingNic(newNic) ? normalizeNationalId(newNic) : null,
        bill_numbers: expectedShortBills.join(', '),
        branch_id: effectiveBranch,
        created_at: new Date().toISOString(),
      }]);
    }

    await invalidateCachesForBranch(effectiveBranch);
  } catch (err) {
    console.warn('[CrossSync] syncClientAcrossModules non-fatal warning:', err);
  }
}

/**
 * Reverse-syncs edits made on `stock_customers` back into same-branch `clients`,
 * `pawns.unique_tag`, and caches without overwriting unrelated branch clients.
 */
export async function syncStockCustomerToClients(params: {
  branchId: string;
  oldNic?: string | null;
  newNic?: string | null;
  oldName?: string | null;
  oldPhone?: string | null;
  name?: string | null;
  tp?: string | null;
  address?: string | null;
}): Promise<void> {
  try {
    const effectiveBranch = normalizeBranchId(params.branchId || 'HQ');
    const branchTerms = getBranchSearchTerms(effectiveBranch);

    const oldNic = String(params.oldNic || '').trim();
    const newNic = String(params.newNic || oldNic || '').trim();
    const searchNics = new Set<string>();
    if (!isDummyOrPendingNic(oldNic)) {
      searchNics.add(normalizeNationalId(oldNic));
      searchNics.add(oldNic);
    }
    if (!isDummyOrPendingNic(newNic)) {
      searchNics.add(normalizeNationalId(newNic));
      searchNics.add(newNic);
    }

    const { data: branchClients } = await adminSupabase
      .from('clients')
      .select('id, national_id, first_name, last_name, phone, address, branch_id')
      .in('branch_id', branchTerms);

    let matchedClient: any = null;
    if (branchClients && branchClients.length > 0) {
      if (searchNics.size > 0) {
        const upperSet = new Set(Array.from(searchNics).map((s) => s.toUpperCase()));
        matchedClient = branchClients.find((c: any) => {
          const cNic = String(c.national_id || '').trim();
          return (
            upperSet.has(cNic.toUpperCase()) ||
            upperSet.has(normalizeNationalId(cNic).toUpperCase())
          );
        });
      }
      if (!matchedClient && params.oldName && params.oldPhone) {
        const cleanPhone = String(params.oldPhone).replace(/\D/g, '');
        const cleanName = String(params.oldName).trim().toLowerCase();
        if (cleanPhone.length >= 9 && cleanName.length > 1) {
          matchedClient = branchClients.find((c: any) => {
            const cPhone = String(c.phone || '').replace(/\D/g, '');
            const cName = buildFullName(c.first_name, c.last_name).toLowerCase();
            return cPhone === cleanPhone && cName === cleanName;
          });
        }
      }
    }

    if (matchedClient) {
      const updates: Record<string, any> = {};
      if (params.name && params.name.trim()) {
        const { first_name, last_name } = splitFullName(params.name);
        updates.first_name = first_name;
        updates.last_name = last_name;
      }
      if (params.tp !== undefined && params.tp !== null && String(params.tp).trim() !== '') {
        updates.phone = String(params.tp).trim();
      }
      if (params.address !== undefined && params.address !== null && String(params.address).trim() !== '') {
        updates.address = String(params.address).trim();
      }

      const normalizedNewNic = !isDummyOrPendingNic(newNic) ? normalizeNationalId(newNic) : '';
      if (
        normalizedNewNic &&
        normalizeNationalId(matchedClient.national_id) !== normalizedNewNic
      ) {
        // Only update national_id if no other client in the same branch already holds it
        const conflict = (branchClients || []).find(
          (c: any) =>
            c.id !== matchedClient.id &&
            normalizeNationalId(c.national_id).toUpperCase() === normalizedNewNic.toUpperCase()
        );
        if (!conflict) {
          updates.national_id = normalizedNewNic;
        }
      }

      if (Object.keys(updates).length > 0) {
        await adminSupabase.from('clients').update(updates).eq('id', matchedClient.id);
      }

      if (updates.national_id) {
        const { data: clientPawns } = await adminSupabase
          .from('pawns')
          .select('id, bill_no, unique_tag')
          .in('branch_id', branchTerms)
          .eq('client_id', matchedClient.id);
        for (const p of clientPawns || []) {
          const nextTag = generateUniqueOrderTag(
            effectiveBranch,
            updates.national_id,
            p.bill_no || p.id
          );
          if (nextTag !== p.unique_tag) {
            await adminSupabase.from('pawns').update({ unique_tag: nextTag }).eq('id', p.id);
          }
        }
      }
    }

    await invalidateCachesForBranch(effectiveBranch);
  } catch (err) {
    console.warn('[CrossSync] syncStockCustomerToClients non-fatal warning:', err);
  }
}

/**
 * Updates `stock_customers.bill_numbers` inside `branchId` when a bill number is
 * renamed (`newBillNo` provided) or unlinked/deleted (`newBillNo === null`).
 */
export async function syncCustomerBillList(params: {
  branchId: string;
  oldBillNo: string;
  newBillNo?: string | null;
}): Promise<void> {
  try {
    const oldBill = String(params.oldBillNo || '').trim();
    if (!oldBill) return;

    const branchTerms = getBranchSearchTerms(normalizeBranchId(params.branchId || 'HQ'));
    const { data: rows } = await adminSupabase
      .from('stock_customers')
      .select('id, bill_numbers')
      .in('branch_id', branchTerms);

    if (!rows || rows.length === 0) return;

    const cleanNew =
      params.newBillNo !== undefined && params.newBillNo !== null
        ? stripBranchPrefix(String(params.newBillNo)).trim()
        : null;

    for (const row of rows) {
      const raw = String(row.bill_numbers || '').trim();
      if (!raw) continue;
      const tokens = raw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      let changed = false;
      const updatedTokens: string[] = [];
      for (const token of tokens) {
        if (isSameBranchBill(token, oldBill)) {
          changed = true;
          if (cleanNew) updatedTokens.push(cleanNew);
        } else {
          updatedTokens.push(token);
        }
      }

      if (changed) {
        const deduped = Array.from(new Set(updatedTokens.filter(Boolean)));
        await adminSupabase
          .from('stock_customers')
          .update({ bill_numbers: deduped.join(', ') })
          .eq('id', row.id);
      }
    }
  } catch (err) {
    console.warn('[CrossSync] syncCustomerBillList non-fatal warning:', err);
  }
}

/**
 * Blocks direct non-ticket edits if the target branch/date ledger is explicitly LOCKED.
 */
export async function assertLedgerUnlocked(
  branchId: string,
  recordDate?: string | null,
  allowLockedLedger = false
): Promise<void> {
  if (allowLockedLedger) return;
  const dateCandidates = buildLedgerDateCandidates(recordDate);
  if (dateCandidates.length === 0) return;

  const branchTerms = getBranchSearchTerms(normalizeBranchId(branchId || 'HQ'));
  const { data: ledgers } = await adminSupabase
    .from('daily_ledgers')
    .select('id, ledger_date, status')
    .in('branch_id', branchTerms)
    .in('ledger_date', dateCandidates);

  const locked = (ledgers || []).find(
    (l: any) => String(l.status || '').toUpperCase() === 'LOCKED'
  );
  if (locked) {
    throw new Error(
      `Daily Ledger for ${locked.ledger_date} is LOCKED. Submit or approve a Manager Change Request ticket to modify this record.`
    );
  }
}

/**
 * Applies numeric deltas to a `daily_ledgers` row and recomputes closing_balance,
 * cp_balance, variance, and status consistently across modules.
 */
export async function applyLedgerTotalsDelta(params: {
  ledgerId: string;
  deltaLoan?: number;
  deltaRedeem?: number;
  deltaInterest?: number;
  deltaInsurance?: number;
  allowLockedLedger?: boolean;
  actorSession?: any;
  reason?: string;
}): Promise<boolean> {
  const {
    ledgerId,
    deltaLoan = 0,
    deltaRedeem = 0,
    deltaInterest = 0,
    deltaInsurance = 0,
    allowLockedLedger = false,
  } = params;

  const hasDelta =
    Math.abs(deltaLoan) >= 0.001 ||
    Math.abs(deltaRedeem) >= 0.001 ||
    Math.abs(deltaInterest) >= 0.001 ||
    Math.abs(deltaInsurance) >= 0.001;
  if (!hasDelta || !ledgerId) return false;

  const { data: ledger } = await adminSupabase
    .from('daily_ledgers')
    .select('*')
    .eq('id', ledgerId)
    .maybeSingle();
  if (!ledger) return false;

  const isLocked = String(ledger.status || '').toUpperCase() === 'LOCKED';
  if (isLocked && !allowLockedLedger) {
    throw new Error(
      `Daily Ledger for ${ledger.ledger_date} is LOCKED. Direct modification blocked.`
    );
  }

  const calcOpeningCash = Number(ledger.opening_balance || 0);
  const calcTrIn = Number(ledger.transfer_in || 0);
  const calcTrOut = Number(ledger.transfer_out || 0);
  const oldLoans = Number(ledger.loan_issued_total || 0);
  const oldRedeem = Number(ledger.redemption_total || 0);
  const oldInterest = Number(ledger.interest_rec_total || 0);
  const calcRecovery = Number(ledger.recovery_total || 0);
  const oldInsurance = Number(ledger.insurance_total || 0);
  const calcExpenses = Number(ledger.expenses_total || 0);
  const userOpeningCapital = Number(ledger.opening_capital || 0);
  const oldCpBalance = Number(ledger.cp_balance || 0);
  const oldClosingCash = Number(ledger.closing_balance || 0);

  const newLoans = Math.max(0, Number((oldLoans + deltaLoan).toFixed(2)));
  const newRedeem = Math.max(0, Number((oldRedeem + deltaRedeem).toFixed(2)));
  const newInterest = Math.max(0, Number((oldInterest + deltaInterest).toFixed(2)));
  const newInsurance = Math.max(0, Number((oldInsurance + deltaInsurance).toFixed(2)));

  const oldCalcClosing = Number(
    (
      calcOpeningCash +
      calcTrIn -
      calcTrOut -
      oldLoans +
      oldRedeem +
      oldInterest +
      calcRecovery +
      oldInsurance -
      calcExpenses
    ).toFixed(2)
  );
  const newCalcClosing = Number(
    (
      calcOpeningCash +
      calcTrIn -
      calcTrOut -
      newLoans +
      newRedeem +
      newInterest +
      calcRecovery +
      newInsurance -
      calcExpenses
    ).toFixed(2)
  );

  const wasClosingAutoCalculated =
    Math.abs(oldClosingCash - oldCalcClosing) < 0.05 || ledger.actual_cash_count == null;
  const nextClosingCash = wasClosingAutoCalculated ? newCalcClosing : oldClosingCash;
  const nextVariance = Number((nextClosingCash - newCalcClosing).toFixed(2));
  const nextStatus = isLocked
    ? 'LOCKED'
    : Math.abs(nextVariance) >= 0.01 && !ledger.is_flag_ignored
    ? 'FLAGGED'
    : 'APPROVED';

  let nextCpBalance = oldCpBalance;
  if (userOpeningCapital > 0 || oldCpBalance > 0) {
    const oldCalcCp = Number((userOpeningCapital + oldLoans - oldRedeem).toFixed(2));
    if (Math.abs(oldCpBalance - oldCalcCp) < 0.05) {
      nextCpBalance = Number((userOpeningCapital + newLoans - newRedeem).toFixed(2));
    } else {
      nextCpBalance = Math.max(0, Number((oldCpBalance + deltaLoan - deltaRedeem).toFixed(2)));
    }
  }

  await adminSupabase
    .from('daily_ledgers')
    .update({
      loan_issued_total: newLoans,
      redemption_total: newRedeem,
      interest_rec_total: newInterest,
      insurance_total: newInsurance,
      closing_balance: nextClosingCash,
      cp_balance: nextCpBalance,
      variance: nextVariance,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ledger.id);

  const effectiveBranch = normalizeBranchId(ledger.branch_id || 'HQ');
  await recordAuditLog(params.actorSession || { branchId: effectiveBranch, role: 'SYSTEM' }, {
    action: 'LEDGER_AUTO_SYNC',
    resource: 'daily_ledgers',
    branchId: effectiveBranch,
    details: {
      ledger_id: ledger.id,
      ledger_date: ledger.ledger_date,
      delta_loan: deltaLoan,
      delta_redeem: deltaRedeem,
      delta_interest: deltaInterest,
      delta_insurance: deltaInsurance,
      reason: params.reason || 'Automatic cross-module sync',
    },
  });

  return true;
}

/**
 * Automatically updates or unlinks matching `daily_ledger_transactions` entries
 * for a modified/deleted/restored bill and recalculates `daily_ledgers` totals,
 * cash closing balance, capital balance, variance, and status.
 */
export async function syncDailyLedgerForBillChange(params: {
  action: 'UPDATE' | 'DELETE' | 'RESTORE';
  branchId: string;
  oldBillNo: string;
  newBillNo?: string;
  oldAmount?: number;
  newAmount?: number;
  newWeightGrams?: number;
  newItemCode?: string;
  recordDate?: string | null;
  allowLockedLedger?: boolean;
  actorSession?: any;
  reason?: string;
}): Promise<{ updatedLedgerIds: string[]; modifiedTxCount: number }> {
  const result = { updatedLedgerIds: [] as string[], modifiedTxCount: 0 };
  try {
    const oldBill = String(params.oldBillNo || '').trim();
    if (!oldBill) return result;

    const effectiveBranch = normalizeBranchId(params.branchId || 'HQ');
    const branchTerms = getBranchSearchTerms(effectiveBranch);
    const primaryDates = buildLedgerDateCandidates(params.recordDate);
    const expandedDates = new Set<string>(primaryDates);
    for (const d of primaryDates) {
      const prev = shiftDateDays(d, -1);
      const next = shiftDateDays(d, 1);
      if (prev) expandedDates.add(prev);
      if (next) expandedDates.add(next);
    }

    let ledgerQuery = adminSupabase
      .from('daily_ledgers')
      .select('*')
      .in('branch_id', branchTerms);

    if (expandedDates.size > 0) {
      ledgerQuery = ledgerQuery.in('ledger_date', Array.from(expandedDates));
    } else {
      ledgerQuery = ledgerQuery.order('ledger_date', { ascending: false }).limit(14);
    }

    const { data: candidateLedgers } = await ledgerQuery;
    if (!candidateLedgers || candidateLedgers.length === 0) return result;

    const cleanNewBill = params.newBillNo
      ? stripBranchPrefix(params.newBillNo).trim()
      : undefined;

    for (const ledger of candidateLedgers) {
      const isLocked = String(ledger.status || '').toUpperCase() === 'LOCKED';
      const isPrimaryDate =
        primaryDates.length === 0 || primaryDates.includes(String(ledger.ledger_date));

      const { data: txRows } = await adminSupabase
        .from('daily_ledger_transactions')
        .select('*')
        .eq('ledger_id', ledger.id);

      const allTx = txRows || [];
      const matchingTx =
        params.action === 'RESTORE'
          ? allTx.filter((t: any) => isSameBranchBill(t.redeem_no, oldBill))
          : allTx.filter((t: any) => isSameBranchBill(t.bill_no, oldBill));

      // Skip neighbor ±1 day ledgers unless an exact transaction row was actually found there
      if (!isPrimaryDate && matchingTx.length === 0) continue;

      if (isLocked && !params.allowLockedLedger && (matchingTx.length > 0 || isPrimaryDate)) {
        throw new Error(
          `Daily Ledger for ${ledger.ledger_date} is LOCKED. Direct modification blocked.`
        );
      }

      let deltaLoan = 0;
      let deltaRedeem = 0;
      let deltaInterest = 0;
      let deltaInsurance = 0;
      let modifiedOnThisLedger = false;

      if (matchingTx.length > 0) {
        for (const row of matchingTx) {
          if (params.action === 'DELETE') {
            deltaLoan -= Number(row.amount || 0);
            deltaInsurance -= Number(row.insurance_rs || 0);

            const hasRightSideData =
              Boolean(String(row.redeem_no || '').trim()) ||
              Number(row.cash_received || 0) !== 0 ||
              Number(row.interest_rs || 0) !== 0;

            if (hasRightSideData) {
              await adminSupabase
                .from('daily_ledger_transactions')
                .update({
                  bill_no: '',
                  amount: 0,
                  weight_g: 0,
                  weight_mg: 0,
                  insurance_rs: 0,
                  item_code: '',
                })
                .eq('id', row.id);
            } else {
              await adminSupabase
                .from('daily_ledger_transactions')
                .delete()
                .eq('id', row.id);
            }
            modifiedOnThisLedger = true;
            result.modifiedTxCount++;
          } else if (params.action === 'RESTORE') {
            deltaRedeem -= Number(row.cash_received || 0);
            deltaInterest -= Number(row.interest_rs || 0);

            const hasLeftSideData =
              Boolean(String(row.bill_no || '').trim()) || Number(row.amount || 0) !== 0;

            if (hasLeftSideData) {
              await adminSupabase
                .from('daily_ledger_transactions')
                .update({
                  redeem_no: '',
                  cash_received: 0,
                  interest_rs: 0,
                  type_ir: '',
                  fs_type: '',
                })
                .eq('id', row.id);
            } else {
              await adminSupabase
                .from('daily_ledger_transactions')
                .delete()
                .eq('id', row.id);
            }
            modifiedOnThisLedger = true;
            result.modifiedTxCount++;
          } else if (params.action === 'UPDATE') {
            const txPatch: Record<string, any> = {};
            const oldTxAmt = Number(row.amount || 0);

            if (cleanNewBill && cleanNewBill !== String(row.bill_no || '').trim()) {
              txPatch.bill_no = cleanNewBill;
            }
            if (
              params.newAmount !== undefined &&
              Number.isFinite(Number(params.newAmount)) &&
              Number(params.newAmount) !== oldTxAmt
            ) {
              const nextAmt = Number(params.newAmount);
              txPatch.amount = nextAmt;
              deltaLoan += nextAmt - oldTxAmt;
            }
            if (
              params.newWeightGrams !== undefined &&
              Number.isFinite(Number(params.newWeightGrams))
            ) {
              const totalW = Number(params.newWeightGrams);
              const g = Math.floor(totalW);
              const mg = Math.round((totalW - g) * 1000);
              txPatch.weight_g = g;
              txPatch.weight_mg = mg;
            }
            if (params.newItemCode !== undefined && params.newItemCode.trim() !== '') {
              txPatch.item_code = params.newItemCode.trim();
            }

            if (Object.keys(txPatch).length > 0) {
              await adminSupabase
                .from('daily_ledger_transactions')
                .update(txPatch)
                .eq('id', row.id);
              modifiedOnThisLedger = true;
              result.modifiedTxCount++;
            }
          }
        }
      } else if (isPrimaryDate && allTx.length === 0) {
        // Summary-only daily ledger (no itemized tx rows stored)
        const oldLoanTotal = Number(ledger.loan_issued_total || 0);
        if (
          params.action === 'DELETE' &&
          params.oldAmount !== undefined &&
          params.oldAmount > 0 &&
          oldLoanTotal >= Number(params.oldAmount)
        ) {
          deltaLoan -= Number(params.oldAmount);
          modifiedOnThisLedger = true;
        } else if (
          params.action === 'UPDATE' &&
          params.oldAmount !== undefined &&
          params.newAmount !== undefined &&
          Number(params.oldAmount) !== Number(params.newAmount) &&
          oldLoanTotal >= Number(params.oldAmount)
        ) {
          deltaLoan += Number(params.newAmount) - Number(params.oldAmount);
          modifiedOnThisLedger = true;
        }
      }

      if (!modifiedOnThisLedger) continue;

      const hasTotalDelta =
        Math.abs(deltaLoan) >= 0.001 ||
        Math.abs(deltaRedeem) >= 0.001 ||
        Math.abs(deltaInterest) >= 0.001 ||
        Math.abs(deltaInsurance) >= 0.001;

      if (hasTotalDelta) {
        await applyLedgerTotalsDelta({
          ledgerId: ledger.id,
          deltaLoan,
          deltaRedeem,
          deltaInterest,
          deltaInsurance,
          allowLockedLedger: params.allowLockedLedger,
          actorSession: params.actorSession,
          reason:
            params.reason ||
            `Auto-sync (${params.action}) for bill ${oldBill}${cleanNewBill ? ' -> ' + cleanNewBill : ''}`,
        });
      } else {
        await recordAuditLog(params.actorSession || { branchId: effectiveBranch, role: 'SYSTEM' }, {
          action: 'LEDGER_AUTO_SYNC',
          resource: 'daily_ledgers',
          branchId: effectiveBranch,
          details: {
            ledger_id: ledger.id,
            ledger_date: ledger.ledger_date,
            trigger_action: params.action,
            old_bill_no: oldBill,
            new_bill_no: cleanNewBill || null,
            reason: params.reason || 'Automatic cross-module bill reference sync',
          },
        });
      }

      result.updatedLedgerIds.push(ledger.id);
    }
  } catch (err: any) {
    if (String(err?.message || '').includes('LOCKED')) throw err;
    console.warn('[CrossSync] syncDailyLedgerForBillChange non-fatal warning:', err);
  }
  return result;
}

async function resolvePairedPawnAndStock(params: {
  branchId?: string;
  pawnId?: string;
  stockId?: string;
  billNo?: string;
}): Promise<{ pawn: any; stock: any; branchId: string; branchTerms: string[] }> {
  let pawn: any = null;
  let stock: any = null;

  if (params.pawnId) {
    const { data } = await adminSupabase
      .from('pawns')
      .select('*')
      .eq('id', params.pawnId)
      .maybeSingle();
    pawn = data;
  }
  if (params.stockId) {
    const { data } = await adminSupabase
      .from('stock_items')
      .select('*')
      .eq('id', params.stockId)
      .maybeSingle();
    stock = data;
  }

  const branchRaw = params.branchId || pawn?.branch_id || stock?.branch_id || 'HQ';
  const branchId = normalizeBranchId(branchRaw);
  const branchTerms = getBranchSearchTerms(branchId);
  // Prefer the persisted bill_no on the fetched pawn/stock row before any incoming new bill_no
  const refBillNo = String(pawn?.bill_no || stock?.bill_no || params.billNo || '').trim();

  if (!stock && refBillNo) {
    const { data: candidates } = await adminSupabase
      .from('stock_items')
      .select('*')
      .in('branch_id', branchTerms);
    stock = (candidates || []).find((s: any) => isSameBranchBill(s.bill_no, refBillNo)) || null;
  }

  if (!pawn && refBillNo) {
    const { data: candidates } = await adminSupabase
      .from('pawns')
      .select('*')
      .in('branch_id', branchTerms);
    pawn = (candidates || []).find((p: any) => isSameBranchBill(p.bill_no, refBillNo)) || null;
  }

  return { pawn, stock, branchId, branchTerms };
}

/**
 * Bidirectional update sync across `pawns`, `pawn_items`, `stock_items`,
 * `stock_customers`, `stock_interests`, `rejected_evaluations`, and `daily_ledgers`.
 */
export async function syncPawnAndStockUpdate(params: {
  source: 'PAWN' | 'STOCK';
  pawnId?: string;
  stockId?: string;
  branchId?: string;
  updates: Record<string, any>;
  allowLockedLedger?: boolean;
  actorSession?: any;
  reason?: string;
}): Promise<{ pawn: any; stock: any }> {
  const { pawn, stock, branchId } = await resolvePairedPawnAndStock({
    branchId: params.branchId,
    pawnId: params.pawnId,
    stockId: params.stockId,
    billNo: params.updates.bill_no,
  });

  if (!pawn && !stock) {
    throw new Error('Target pawn/stock record could not be found.');
  }

  const u = params.updates || {};
  const oldBranch = normalizeBranchId(branchId || pawn?.branch_id || stock?.branch_id || 'HQ');
  const nextBranch = normalizeBranchId(u.branch_id || oldBranch);
  const oldBillNo = String(pawn?.bill_no || stock?.bill_no || '').trim();
  const nextBillNoRaw = u.bill_no !== undefined ? String(u.bill_no).trim() : '';
  const hasBillRename = Boolean(nextBillNoRaw && oldBillNo && !isSameBranchBill(nextBillNoRaw, oldBillNo)) || nextBranch !== oldBranch;
  const formattedBillNo = nextBillNoRaw
    ? formatBranchScopedBillNo(nextBillNoRaw, nextBranch)
    : oldBillNo
    ? formatBranchScopedBillNo(oldBillNo, nextBranch)
    : '';
  const shortBillNo = formattedBillNo ? stripBranchPrefix(formattedBillNo).trim() : '';

  const oldAmount =
    pawn?.disbursed_amount !== undefined
      ? Number(pawn.disbursed_amount)
      : stock?.price !== undefined
      ? Number(stock.price)
      : 0;
  const rawNewAmount =
    u.disbursed_amount !== undefined
      ? Number(u.disbursed_amount)
      : u.price !== undefined
      ? Number(u.price)
      : u.amount !== undefined
      ? Number(u.amount)
      : undefined;

  const rawNewWeightGrams =
    u.weight_grams !== undefined
      ? Number(u.weight_grams)
      : u.weight !== undefined
      ? Number(u.weight)
      : u.weight_mg !== undefined
      ? Number(u.weight_mg) / 1000
      : undefined;

  const recordDate =
    stock?.date || (pawn?.created_at ? getSriLankaDate(pawn.created_at) : null);

  // Enforce locked ledger check if financial/bill changes occur outside ticket override
  const financialOrBillChanged =
    hasBillRename ||
    (rawNewAmount !== undefined && Number.isFinite(rawNewAmount) && Math.abs(rawNewAmount - oldAmount) > 0.001);

  if (financialOrBillChanged) {
    await assertLedgerUnlocked(oldBranch, recordDate, Boolean(params.allowLockedLedger));
  }

  // 1. Sync PAWN record
  let updatedPawn = pawn;
  if (pawn) {
    const pawnPatch: Record<string, any> = {};
    if (formattedBillNo && (u.bill_no !== undefined || nextBranch !== oldBranch)) {
      pawnPatch.bill_no = formattedBillNo;
    }
    if (u.branch_id && nextBranch !== oldBranch) pawnPatch.branch_id = nextBranch;
    if (rawNewAmount !== undefined && Number.isFinite(rawNewAmount)) {
      pawnPatch.disbursed_amount = rawNewAmount;
    }
    if (u.appraised_value !== undefined && Number.isFinite(Number(u.appraised_value))) {
      pawnPatch.appraised_value = Number(u.appraised_value);
    } else if (
      params.source === 'STOCK' &&
      rawNewAmount !== undefined &&
      Number.isFinite(rawNewAmount) &&
      Number(pawn.appraised_value || 0) === oldAmount
    ) {
      pawnPatch.appraised_value = rawNewAmount;
    }
    if (rawNewWeightGrams !== undefined && Number.isFinite(rawNewWeightGrams)) {
      pawnPatch.weight_grams = Number(rawNewWeightGrams.toFixed(3));
      pawnPatch.weight_mg = u.weight_mg !== undefined ? Number(u.weight_mg) : Math.round(rawNewWeightGrams * 1000);
    } else if (u.weight_mg !== undefined && Number.isFinite(Number(u.weight_mg))) {
      pawnPatch.weight_mg = Number(u.weight_mg);
      pawnPatch.weight_grams = Number((Number(u.weight_mg) / 1000).toFixed(3));
    }
    if (u.description !== undefined) pawnPatch.description = u.description;
    else if (params.source === 'STOCK' && u.item_type && (!pawn.description || pawn.description.trim() === (stock?.item_type || '').trim())) {
      pawnPatch.description = String(u.item_type).trim();
    }
    if (u.period_months !== undefined && Number.isFinite(Number(u.period_months))) {
      pawnPatch.period_months = Number(u.period_months);
    }
    if (u.interest_rate !== undefined && Number.isFinite(Number(u.interest_rate))) {
      pawnPatch.interest_rate = Number(u.interest_rate);
    }
    if (u.date !== undefined) {
      // Keep created_at aligned on explicit stock date updates when stock edit changes date
      const cleanDate = String(u.date).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        const currentTimeSlice = String(pawn.created_at || '').slice(10) || 'T06:00:00.000Z';
        pawnPatch.created_at = `${cleanDate}${currentTimeSlice.startsWith('T') ? currentTimeSlice : 'T06:00:00.000Z'}`;
      }
    }

    // Map stock status changes back onto pawn
    if (u.status !== undefined) {
      const sUpper = String(u.status).toUpperCase();
      if (sUpper === 'WITHDRAWN' || sUpper === 'REDEEMED') {
        pawnPatch.status = 'REDEEMED';
        pawnPatch.redeemed_at = u.withdrawal_date
          ? new Date(u.withdrawal_date).toISOString()
          : pawn.redeemed_at || new Date().toISOString();
        if (u.redeemed_by !== undefined) pawnPatch.redeemed_by = u.redeemed_by;
        if (u.redeem_amount !== undefined) pawnPatch.redeem_amount = u.redeem_amount;
        else if (pawn.redeem_amount == null) {
          pawnPatch.redeem_amount = rawNewAmount ?? stock?.price ?? pawn.disbursed_amount ?? 0;
        }
      } else if (sUpper === 'ACTIVE') {
        pawnPatch.status = 'ACTIVE';
        pawnPatch.redeemed_at = null;
        pawnPatch.redeemed_by = null;
        pawnPatch.redeem_amount = null;
        pawnPatch.redeem_interest = null;
      } else {
        pawnPatch.status = u.status;
      }
    }

    // Regenerate unique_tag if bill_no or branch_id changed
    if (pawnPatch.bill_no || pawnPatch.branch_id) {
      let nicForTag = '';
      if (isUUID(pawn.client_id)) {
        const { data: cl } = await adminSupabase
          .from('clients')
          .select('national_id')
          .eq('id', pawn.client_id)
          .maybeSingle();
        if (cl?.national_id && !isDummyOrPendingNic(cl.national_id)) {
          nicForTag = cl.national_id;
        }
      } else if (pawn.client_id && !isDummyOrPendingNic(pawn.client_id)) {
        nicForTag = pawn.client_id;
      }
      if (nicForTag) {
        pawnPatch.unique_tag = generateUniqueOrderTag(
          nextBranch,
          nicForTag,
          pawnPatch.bill_no || oldBillNo
        );
      }
    }

    if (Object.keys(pawnPatch).length > 0) {
      const { data, error } = await adminSupabase
        .from('pawns')
        .update(pawnPatch)
        .eq('id', pawn.id)
        .select()
        .single();
      if (error) throw error;
      updatedPawn = data;
    }

    // Keep pawn_items synced cleanly
    const { data: pItems } = await adminSupabase
      .from('pawn_items')
      .select('*')
      .eq('pawn_id', pawn.id);

    if (pItems && pItems.length > 0) {
      if (pItems.length === 1) {
        const itemPatch: Record<string, any> = {};
        if (rawNewWeightGrams !== undefined && Number.isFinite(rawNewWeightGrams)) {
          itemPatch.weight_grams = Number(rawNewWeightGrams.toFixed(3));
          itemPatch.weight_mg = Math.round(rawNewWeightGrams * 1000);
        }
        if (u.appraised_value !== undefined && Number.isFinite(Number(u.appraised_value))) {
          itemPatch.appraised_value = Number(u.appraised_value);
        }
        if (u.item_type !== undefined) itemPatch.item_type = String(u.item_type).trim();
        if (u.description !== undefined) itemPatch.description = String(u.description).trim();
        if (Object.keys(itemPatch).length > 0) {
          await adminSupabase.from('pawn_items').update(itemPatch).eq('id', pItems[0].id);
        }
      } else if (rawNewWeightGrams !== undefined && Number.isFinite(rawNewWeightGrams)) {
        const oldSum = pItems.reduce((s: number, it: any) => s + Number(it.weight_grams || 0), 0);
        if (oldSum > 0) {
          const factor = rawNewWeightGrams / oldSum;
          for (const it of pItems) {
            const scaledG = Number((Number(it.weight_grams || 0) * factor).toFixed(3));
            await adminSupabase
              .from('pawn_items')
              .update({ weight_grams: scaledG, weight_mg: Math.round(scaledG * 1000) })
              .eq('id', it.id);
          }
        }
      }
    }
  }

  // 2. Sync STOCK_ITEMS record (always store short stripped bill_no in stock_items)
  let updatedStock = stock;
  if (stock) {
    const stockPatch: Record<string, any> = {};
    if (shortBillNo && (u.bill_no !== undefined || nextBranch !== oldBranch)) {
      stockPatch.bill_no = shortBillNo;
    }
    if (u.branch_id && nextBranch !== oldBranch) stockPatch.branch_id = nextBranch;
    if (rawNewAmount !== undefined && Number.isFinite(rawNewAmount)) {
      stockPatch.price = rawNewAmount;
    }
    if (rawNewWeightGrams !== undefined && Number.isFinite(rawNewWeightGrams)) {
      stockPatch.weight = Number(rawNewWeightGrams.toFixed(3));
    }
    if (u.item_type !== undefined) stockPatch.item_type = String(u.item_type).trim();
    else if (u.description !== undefined) stockPatch.item_type = String(u.description).slice(0, 50);
    if (u.date !== undefined) stockPatch.date = String(u.date).slice(0, 10);
    if (u.withdrawal_date !== undefined) stockPatch.withdrawal_date = u.withdrawal_date || null;
    if (u.withdrawal_reason !== undefined) stockPatch.withdrawal_reason = u.withdrawal_reason || null;
    if (u.withdrawal_notes !== undefined) stockPatch.withdrawal_notes = u.withdrawal_notes || null;

    if (u.status !== undefined) {
      const sUpper = String(u.status).toUpperCase();
      if (sUpper === 'ACTIVE') {
        stockPatch.status = 'Active';
        stockPatch.withdrawal_date = null;
        stockPatch.withdrawal_reason = null;
        stockPatch.withdrawal_notes = null;
      } else if (sUpper === 'WITHDRAWN' || sUpper === 'REDEEMED') {
        stockPatch.status = 'Withdrawn';
        stockPatch.withdrawal_date = u.withdrawal_date || stock.withdrawal_date || new Date().toISOString().split('T')[0];
        stockPatch.withdrawal_reason = u.withdrawal_reason || stock.withdrawal_reason || 'Pawn Redeemed';
      } else {
        stockPatch.status = u.status;
      }
    }

    if (Object.keys(stockPatch).length > 0) {
      const { data, error } = await adminSupabase
        .from('stock_items')
        .update(stockPatch)
        .eq('id', stock.id)
        .select()
        .single();
      if (error) throw error;
      updatedStock = data;
    }
  }

  // 3. Rename bill number in stock_customers, stock_interests, rejected_evaluations
  if (hasBillRename && oldBillNo && shortBillNo) {
    await syncCustomerBillList({
      branchId: oldBranch,
      oldBillNo,
      newBillNo: shortBillNo,
    });

    const branchTerms = getBranchSearchTerms(oldBranch);
    const { data: interests } = await adminSupabase
      .from('stock_interests')
      .select('id, bill_no')
      .in('branch_id', branchTerms);
    for (const si of interests || []) {
      if (isSameBranchBill(si.bill_no, oldBillNo)) {
        await adminSupabase
          .from('stock_interests')
          .update({ bill_no: shortBillNo, branch_id: nextBranch })
          .eq('id', si.id);
      }
    }

    const oldStatusFormats = Array.from(
      new Set([`BILL:${oldBillNo}`, `BILL:${stripBranchPrefix(oldBillNo).trim()}`])
    );
    await adminSupabase
      .from('rejected_evaluations')
      .update({ status: `BILL:${shortBillNo}` })
      .in('status', oldStatusFormats);
  }

  // 4. Sync Daily Ledger (amounts, weights, bill_no, or restore on Active switch)
  if (
    u.status !== undefined &&
    String(u.status).toUpperCase() === 'ACTIVE' &&
    stock &&
    String(stock.status || '').toUpperCase() === 'WITHDRAWN' &&
    stock.withdrawal_date
  ) {
    await syncDailyLedgerForBillChange({
      action: 'RESTORE',
      branchId: oldBranch,
      oldBillNo: shortBillNo || oldBillNo,
      recordDate: stock.withdrawal_date,
      allowLockedLedger: Boolean(params.allowLockedLedger),
      actorSession: params.actorSession,
      reason: params.reason || 'Stock/Pawn status restored to Active',
    });
  }

  const shouldSyncLedgerUpdate =
    hasBillRename ||
    (rawNewAmount !== undefined && Number.isFinite(rawNewAmount) && Math.abs(rawNewAmount - oldAmount) > 0.001) ||
    rawNewWeightGrams !== undefined ||
    u.item_type !== undefined;

  if (shouldSyncLedgerUpdate && oldBillNo) {
    await syncDailyLedgerForBillChange({
      action: 'UPDATE',
      branchId: oldBranch,
      oldBillNo,
      newBillNo: formattedBillNo || oldBillNo,
      oldAmount,
      newAmount: rawNewAmount,
      newWeightGrams: rawNewWeightGrams,
      newItemCode: u.item_type ? String(u.item_type).slice(0, 30) : undefined,
      recordDate,
      allowLockedLedger: Boolean(params.allowLockedLedger),
      actorSession: params.actorSession,
      reason: params.reason,
    });
  }

  // 5. Optionally sync customer profile if customer fields were passed inline
  if (
    pawn?.client_id &&
    isUUID(pawn.client_id) &&
    (u.first_name !== undefined ||
      u.phone !== undefined ||
      u.address !== undefined ||
      u.national_id !== undefined)
  ) {
    const clientPatch: Record<string, any> = {};
    if (u.first_name !== undefined && String(u.first_name).trim()) {
      const { first_name, last_name } = splitFullName(u.first_name);
      clientPatch.first_name = first_name;
      clientPatch.last_name = last_name;
    }
    if (u.phone !== undefined) clientPatch.phone = String(u.phone).trim();
    if (u.address !== undefined) clientPatch.address = String(u.address).trim();
    if (u.national_id !== undefined && !isDummyOrPendingNic(u.national_id)) {
      clientPatch.national_id = normalizeNationalId(u.national_id);
    }
    if (Object.keys(clientPatch).length > 0) {
      await adminSupabase.from('clients').update(clientPatch).eq('id', pawn.client_id);
      await syncClientAcrossModules({
        clientId: pawn.client_id,
        branchId: nextBranch,
        newNationalId: clientPatch.national_id,
        firstName: clientPatch.first_name,
        lastName: clientPatch.last_name,
        phone: clientPatch.phone,
        address: clientPatch.address,
      });
    }
  }

  await invalidateCachesForBranch(oldBranch);
  if (nextBranch !== oldBranch) await invalidateCachesForBranch(nextBranch);

  return { pawn: updatedPawn, stock: updatedStock };
}

/**
 * Deletes a bill cleanly across `pawns`, `pawn_items`, `stock_items`,
 * `stock_customers.bill_numbers`, `stock_interests`, `rejected_evaluations`,
 * and unlinks/recalculates the matching `daily_ledger_transactions` & `daily_ledgers`.
 */
export async function syncPawnAndStockDelete(params: {
  branchId?: string;
  pawnId?: string;
  stockId?: string;
  billNo?: string;
  allowLockedLedger?: boolean;
  actorSession?: any;
  reason?: string;
}): Promise<{ deletedPawnId: string | null; deletedStockId: string | null; unlinkedLedgers: string[] }> {
  const { pawn, stock, branchId, branchTerms } = await resolvePairedPawnAndStock({
    branchId: params.branchId,
    pawnId: params.pawnId,
    stockId: params.stockId,
    billNo: params.billNo,
  });

  const targetBillNo = String(params.billNo || pawn?.bill_no || stock?.bill_no || '').trim();
  const targetAmount =
    pawn?.disbursed_amount !== undefined
      ? Number(pawn.disbursed_amount)
      : stock?.price !== undefined
      ? Number(stock.price)
      : 0;
  const recordDate = stock?.date || (pawn?.created_at ? getSriLankaDate(pawn.created_at) : null);

  if (branchId && recordDate) {
    await assertLedgerUnlocked(branchId, recordDate, Boolean(params.allowLockedLedger));
  }

  let deletedPawnId: string | null = null;
  let deletedStockId: string | null = null;

  if (pawn?.id) {
    await adminSupabase.from('pawn_items').delete().eq('pawn_id', pawn.id);
    const { error } = await adminSupabase.from('pawns').delete().eq('id', pawn.id);
    if (error) throw error;
    deletedPawnId = pawn.id;
  }

  if (stock?.id) {
    const { error } = await adminSupabase.from('stock_items').delete().eq('id', stock.id);
    if (error) throw error;
    deletedStockId = stock.id;
  }

  if (targetBillNo) {
    await syncCustomerBillList({
      branchId,
      oldBillNo: targetBillNo,
      newBillNo: null,
    });

    const { data: interests } = await adminSupabase
      .from('stock_interests')
      .select('id, bill_no')
      .in('branch_id', branchTerms);
    for (const si of interests || []) {
      if (isSameBranchBill(si.bill_no, targetBillNo)) {
        await adminSupabase.from('stock_interests').delete().eq('id', si.id);
      }
    }

    const oldStatusFormats = Array.from(
      new Set([`BILL:${targetBillNo}`, `BILL:${stripBranchPrefix(targetBillNo).trim()}`])
    );
    await adminSupabase.from('rejected_evaluations').delete().in('status', oldStatusFormats);
  }

  const ledgerSync = targetBillNo
    ? await syncDailyLedgerForBillChange({
        action: 'DELETE',
        branchId,
        oldBillNo: targetBillNo,
        oldAmount: targetAmount,
        recordDate,
        allowLockedLedger: Boolean(params.allowLockedLedger),
        actorSession: params.actorSession,
        reason: params.reason || 'Paired Pawn/Stock record deleted',
      })
    : { updatedLedgerIds: [], modifiedTxCount: 0 };

  await invalidateCachesForBranch(branchId);

  return {
    deletedPawnId,
    deletedStockId,
    unlinkedLedgers: ledgerSync.updatedLedgerIds,
  };
}

/**
 * Restores a withdrawn stock item back to Active, clears `pawns` redemption metadata,
 * unlinks matching `redeem_no` from that day's `daily_ledgers`, and invalidates caches.
 */
export async function syncPawnAndStockRestore(params: {
  branchId?: string;
  stockId?: string;
  pawnId?: string;
  billNo?: string;
  allowLockedLedger?: boolean;
  actorSession?: any;
  reason?: string;
}): Promise<{ stock: any; pawn: any }> {
  const { pawn, stock, branchId } = await resolvePairedPawnAndStock({
    branchId: params.branchId,
    pawnId: params.pawnId,
    stockId: params.stockId,
    billNo: params.billNo,
  });

  if (!stock && !pawn) {
    throw new Error('Stock or Pawn record not found to restore.');
  }

  const withdrawalDate =
    stock?.withdrawal_date || (pawn?.redeemed_at ? getSriLankaDate(pawn.redeemed_at) : null);
  const billNo = String(params.billNo || stock?.bill_no || pawn?.bill_no || '').trim();

  if (withdrawalDate) {
    await assertLedgerUnlocked(branchId, withdrawalDate, Boolean(params.allowLockedLedger));
  }

  let updatedStock = stock;
  if (stock?.id) {
    const { data, error } = await adminSupabase
      .from('stock_items')
      .update({
        status: 'Active',
        withdrawal_date: null,
        withdrawal_reason: null,
        withdrawal_notes: null,
      })
      .eq('id', stock.id)
      .select()
      .single();
    if (error) throw error;
    updatedStock = data;
  }

  let updatedPawn = pawn;
  if (pawn?.id) {
    const { data, error } = await adminSupabase
      .from('pawns')
      .update({
        status: 'ACTIVE',
        redeemed_at: null,
        redeemed_by: null,
        redeem_amount: null,
        redeem_interest: null,
      })
      .eq('id', pawn.id)
      .select()
      .single();
    if (error) throw error;
    updatedPawn = data;
  }

  if (withdrawalDate && billNo) {
    await syncDailyLedgerForBillChange({
      action: 'RESTORE',
      branchId,
      oldBillNo: billNo,
      recordDate: withdrawalDate,
      allowLockedLedger: Boolean(params.allowLockedLedger),
      actorSession: params.actorSession,
      reason: params.reason || 'Stock restored back to Active vault inventory',
    });
  }

  await invalidateCachesForBranch(branchId);

  return { stock: updatedStock, pawn: updatedPawn };
}
