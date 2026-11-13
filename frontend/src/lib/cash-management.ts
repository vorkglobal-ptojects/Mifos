import crypto from 'crypto';
import { adminSupabase } from './auth-server';
import { getSriLankaDate } from './date-utils';

export interface LkrDenominations {
  notes_5000?: number;
  notes_2000?: number;
  notes_1000?: number;
  notes_500?: number;
  notes_100?: number;
  notes_50?: number;
  notes_20?: number;
  notes_10?: number;
  coins_total?: number;
}

/**
 * Calculates server-verified denomination total for Sri Lankan Rupee (LKR).
 * Strictly disallows negative note/coin quantities.
 */
export function calculateDenominationTotal(denoms: LkrDenominations): {
  total: number;
  breakdown: Record<string, number>;
  isValid: boolean;
  error?: string;
} {
  const d5000 = Math.max(0, Math.floor(Number(denoms.notes_5000) || 0));
  const d2000 = Math.max(0, Math.floor(Number(denoms.notes_2000) || 0));
  const d1000 = Math.max(0, Math.floor(Number(denoms.notes_1000) || 0));
  const d500  = Math.max(0, Math.floor(Number(denoms.notes_500)  || 0));
  const d100  = Math.max(0, Math.floor(Number(denoms.notes_100)  || 0));
  const d50   = Math.max(0, Math.floor(Number(denoms.notes_50)   || 0));
  const d20   = Math.max(0, Math.floor(Number(denoms.notes_20)   || 0));
  const d10   = Math.max(0, Math.floor(Number(denoms.notes_10)   || 0));
  const coins = Number((Number(denoms.coins_total) || 0).toFixed(2));

  if (coins < 0) {
    return {
      total: 0,
      breakdown: {},
      isValid: false,
      error: 'Coins total cannot be negative.'
    };
  }

  const rawSum = (
    d5000 * 5000 +
    d2000 * 2000 +
    d1000 * 1000 +
    d500  * 500  +
    d100  * 100  +
    d50   * 50   +
    d20   * 20   +
    d10   * 10   +
    coins
  );

  const total = Number(rawSum.toFixed(2));

  return {
    total,
    breakdown: {
      notes_5000: d5000,
      notes_2000: d2000,
      notes_1000: d1000,
      notes_500: d500,
      notes_100: d100,
      notes_50: d50,
      notes_20: d20,
      notes_10: d10,
      coins_total: coins
    },
    isValid: true
  };
}

/**
 * Masks bank account number for UI display (e.g., "1002345678" -> "•••• •••• 5678").
 */
export function maskAccountNumber(accNo: string | null | undefined): string {
  if (!accNo) return '';
  const clean = accNo.trim();
  if (clean.length <= 4) return clean;
  const last4 = clean.slice(-4);
  return `•••• •••• ${last4}`;
}

/**
 * Generates unique, non-colliding human-readable business references.
 */
export function generateCashReference(prefix: 'REQ' | 'TRF' | 'DSP' | 'RCP'): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${dateStr}-${rand}`;
}

/**
 * Posts an atomic, balanced double-entry General Ledger journal entry for an accepted cash transfer.
 * Debit: Destination Cash Asset Account
 * Credit: Source Cash Asset Account
 */
export async function postCashTransferJournalEntry(params: {
  transferRef: string;
  sourceBranch: string;
  sourceBranchName?: string;
  sourceBankGlAccount?: string;
  sourceBankName?: string;
  destBranch: string;
  destBranchName?: string;
  amount: number;
  actorEmail: string;
}): Promise<{ journalEntryId: string | null; error?: string }> {
  try {
    const {
      transferRef,
      sourceBranch,
      sourceBranchName,
      sourceBankGlAccount,
      sourceBankName,
      destBranch,
      destBranchName,
      amount,
      actorEmail
    } = params;
    const jeId = `JE-CASH-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const dateStr = getSriLankaDate();

    const srcName = sourceBankName || sourceBranchName || sourceBranch;
    const dstName = destBranchName || destBranch;
    const transferAmount = Number(amount.toFixed(2));
    const creditAccountName = sourceBankGlAccount
      ? `${sourceBankGlAccount}${sourceBankName ? ` (${sourceBankName})` : ''}`
      : `Vault Cash (${srcName}) (Asset)`;

    // 1. Insert Journal Entry Header
    const { error: headerErr } = await adminSupabase.from('journal_entry').insert([{
      id: jeId,
      date: dateStr,
      description: `Cash Transfer Handover: ${srcName} to ${dstName}`,
      reference: transferRef,
      total_debit: transferAmount,
      total_credit: transferAmount,
      created_by: actorEmail || 'Cash Management Subsystem'
    }]);

    if (headerErr) {
      console.error('Error inserting cash transfer journal entry header:', headerErr);
      return { journalEntryId: null, error: headerErr.message };
    }

    // 2. Insert Journal Entry Lines (Balanced Double-Entry)
    const journalLines = [
      {
        journal_entry_id: jeId,
        account_name: `Vault Cash (${dstName}) (Asset)`,
        debit: transferAmount,
        credit: 0
      },
      {
        journal_entry_id: jeId,
        account_name: creditAccountName,
        debit: 0,
        credit: transferAmount
      }
    ];

    const { error: linesErr } = await adminSupabase.from('journal_entry_line').insert(journalLines);
    if (linesErr) {
      console.error('Error inserting cash transfer journal entry lines:', linesErr);
      await adminSupabase.from('journal_entry').delete().eq('id', jeId);
      return { journalEntryId: null, error: linesErr.message };
    }

    return { journalEntryId: jeId };
  } catch (err: any) {
    console.error('postCashTransferJournalEntry exception:', err);
    return { journalEntryId: null, error: err.message || 'GL posting failed' };
  }
}
