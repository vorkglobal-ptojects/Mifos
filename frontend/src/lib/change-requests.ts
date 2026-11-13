import { adminSupabase, AuthSession } from './auth-server';
import { normalizeBranchId, stripBranchPrefix, getBranchSearchTerms } from './branch-mapping';
import { invalidateBranchInventoryCache } from './redis';
import {
  CUSTOMER_DELETE_BLOCK_MESSAGE,
  syncClientAcrossModules,
  syncStockCustomerToClients,
  syncPawnAndStockUpdate,
  syncPawnAndStockDelete,
  syncPawnAndStockRestore,
} from './cross-sync';

export type ChangeEntityType = 'PAWN' | 'STOCK' | 'DAILY_LEDGER' | 'INTEREST' | 'CLIENT';
export type ChangeActionType = 'UPDATE' | 'DELETE' | 'RESTORE' | 'LEDGER_ADJUST' | 'VOID_INTEREST';
export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ChangeRecordData = Record<string, unknown>;

export interface ChangeReviewer {
  name?: string;
  email?: string;
}

export interface ChangeRequestTicket {
  id: string;
  ticket_no: string;
  entity_type: ChangeEntityType;
  action_type: ChangeActionType;
  entity_id: string;
  reference_no: string; // Bill No, Ledger Date, or Client NIC
  branch_id: string;
  requested_by_user_id?: string;
  requested_by_name: string;
  requested_by_email: string;
  requested_by_role: string;
  reason: string;
  current_data: ChangeRecordData;
  proposed_data: ChangeRecordData;
  original_proposed_data?: ChangeRecordData;
  edited_by_user_id?: string;
  edited_by_name?: string;
  edited_by_role?: string;
  edited_at?: string;
  status: ChangeRequestStatus;
  reviewed_by_user_id?: string;
  reviewed_by_name?: string;
  reviewed_by_role?: string;
  reviewed_at?: string;
  review_notes?: string;
  created_at: string;
  updated_at?: string;
}

// Generate human-friendly sequential ticket reference e.g. CR-KHT-2611-0042
export function generateTicketNo(branchId: string, entityType: string): string {
  const normBranch = normalizeBranchId(branchId || 'HQ');
  const now = new Date();
  const datePart = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const prefix = entityType.slice(0, 4).toUpperCase();
  return `CR-${prefix}-${normBranch}-${datePart}-${randomPart}`;
}

function parseFiniteNumber(val: unknown): number | undefined {
  if (val === undefined || val === null || String(val).trim() === '') return undefined;
  const parsed = parseFloat(String(val));
  return isNaN(parsed) ? undefined : parsed;
}

function normalizeProposedPayload(
  entityType: ChangeEntityType,
  existing: ChangeRecordData = {},
  incoming?: ChangeRecordData
): ChangeRecordData {
  if (!incoming || typeof incoming !== 'object') return { ...existing };
  const merged: ChangeRecordData = { ...existing, ...incoming };
  if (merged.branch_id !== undefined && String(merged.branch_id).trim() !== '') {
    merged.branch_id = normalizeBranchId(String(merged.branch_id));
  }
  if ((entityType === 'STOCK' || entityType === 'PAWN') && merged.bill_no !== undefined && String(merged.bill_no).trim() !== '') {
    merged.bill_no = stripBranchPrefix(String(merged.bill_no));
  }
  return merged;
}

// Apply approved changes to live database
export async function applyApprovedChange(ticket: ChangeRequestTicket, reviewer: ChangeReviewer) {
  const { entity_type, action_type, entity_id, proposed_data, current_data, branch_id } = ticket;
  const sourceBranch = normalizeBranchId(String(current_data?.branch_id || branch_id || 'HQ'));

  if (entity_type === 'PAWN') {
    if (action_type === 'DELETE') {
      await syncPawnAndStockDelete({
        branchId: sourceBranch,
        pawnId: entity_id,
        billNo: String(current_data?.bill_no || ticket.reference_no || ''),
        allowLockedLedger: true,
        reason: ticket.reason,
      });
    } else if (action_type === 'UPDATE') {
      const updates: Record<string, unknown> = { ...(proposed_data || {}) };
      const disbursed = parseFiniteNumber(proposed_data.disbursed_amount);
      const appraised = parseFiniteNumber(proposed_data.appraised_value);
      const weightGrams = parseFiniteNumber(proposed_data.weight_grams);
      const weightMg = parseFiniteNumber(proposed_data.weight_mg);
      const periodMonths = parseFiniteNumber(proposed_data.period_months);

      if (disbursed !== undefined) updates.disbursed_amount = disbursed;
      if (appraised !== undefined) updates.appraised_value = appraised;
      if (weightGrams !== undefined) updates.weight_grams = weightGrams;
      if (weightMg !== undefined) updates.weight_mg = weightMg;
      if (periodMonths !== undefined && periodMonths > 0) updates.period_months = Math.round(periodMonths);

      await syncPawnAndStockUpdate({
        source: 'PAWN',
        pawnId: entity_id,
        branchId: sourceBranch,
        updates,
        allowLockedLedger: true,
        reason: ticket.reason,
      });
    }
  } else if (entity_type === 'STOCK') {
    if (action_type === 'DELETE') {
      await syncPawnAndStockDelete({
        branchId: sourceBranch,
        stockId: entity_id,
        billNo: String(current_data?.bill_no || ticket.reference_no || ''),
        allowLockedLedger: true,
        reason: ticket.reason,
      });
    } else if (action_type === 'RESTORE') {
      const todayStr = new Date().toISOString().split('T')[0];
      const rawInterest = proposed_data.interest_paid ?? proposed_data.interest_amount ?? 0;
      const interestVal = parseFloat(String(rawInterest)) || 0;
      const cleanNotes = String(proposed_data.notes || '').trim();
      const restoreLine = `[APPROVED RESTORE TO SAFE on ${todayStr} by ${reviewer.name || reviewer.email}] Interest: Rs. ${interestVal}${cleanNotes ? ' | ' + cleanNotes : ''}`;

      const { data: currentStock } = await adminSupabase
        .from('stock_items')
        .select('withdrawal_notes, bill_no, branch_id')
        .eq('id', entity_id)
        .maybeSingle();

      await syncPawnAndStockRestore({
        branchId: normalizeBranchId(String(currentStock?.branch_id || sourceBranch)),
        stockId: entity_id,
        billNo: String(currentStock?.bill_no || current_data?.bill_no || ticket.reference_no || ''),
        allowLockedLedger: true,
        reason: ticket.reason,
      });

      const updatedNotes = currentStock?.withdrawal_notes
        ? `${currentStock.withdrawal_notes}\n${restoreLine}`
        : restoreLine;
      await adminSupabase
        .from('stock_items')
        .update({ withdrawal_notes: updatedNotes })
        .eq('id', entity_id);
    } else if (action_type === 'UPDATE') {
      const updates: Record<string, unknown> = { ...(proposed_data || {}) };
      const parsedPrice = parseFiniteNumber(proposed_data.price);
      const parsedWeight = parseFiniteNumber(proposed_data.weight);
      if (parsedPrice !== undefined) updates.price = parsedPrice;
      if (parsedWeight !== undefined) updates.weight = parsedWeight;

      await syncPawnAndStockUpdate({
        source: 'STOCK',
        stockId: entity_id,
        branchId: sourceBranch,
        updates,
        allowLockedLedger: true,
        reason: ticket.reason,
      });
    }
  } else if (entity_type === 'DAILY_LEDGER') {
    if (action_type === 'DELETE') {
      const dateMatch =
        String(current_data?.ledger_date || '').trim() ||
        (String(ticket.reference_no || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '');
      const ledgerBranch = normalizeBranchId(String(current_data?.branch_id || sourceBranch));

      if (entity_id && /^[0-9a-fA-F-]{36}$/.test(entity_id)) {
        const { error: delErr } = await adminSupabase.from('daily_ledgers').delete().eq('id', entity_id);
        if (delErr) throw new Error(delErr.message || 'Failed to delete daily ledger');
      } else if (ledgerBranch && dateMatch) {
        const { error: delErr } = await adminSupabase
          .from('daily_ledgers')
          .delete()
          .in('branch_id', getBranchSearchTerms(ledgerBranch))
          .eq('ledger_date', dateMatch);
        if (delErr) throw new Error(delErr.message || 'Failed to delete daily ledger');
      } else {
        throw new Error('Daily ledger delete ticket is missing ledger identifier or date.');
      }
    } else {
      const safePayload: ChangeRecordData = { ...(proposed_data || {}) };
      const txList = Array.isArray(safePayload.transactions) ? (safePayload.transactions as Record<string, unknown>[]) : null;
      const expList = Array.isArray(safePayload.expenses) ? (safePayload.expenses as Record<string, unknown>[]) : null;
      delete safePayload.transactions;
      delete safePayload.expenses;
      delete safePayload.id;
      delete safePayload.created_at;

      const dateMatch =
        String(safePayload.ledger_date || current_data?.ledger_date || '').trim() ||
        (String(ticket.reference_no || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '') ||
        (String(entity_id || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '');
      const ledgerBranch = normalizeBranchId(String(safePayload.branch_id || current_data?.branch_id || sourceBranch));

      if (!ledgerBranch || !dateMatch) {
        throw new Error('Daily ledger change ticket is missing branch_id or ledger_date.');
      }

      const ledgerPayload: ChangeRecordData = {
        ...safePayload,
        branch_id: ledgerBranch,
        ledger_date: dateMatch,
        updated_at: new Date().toISOString()
      };
      const { data: upsertedLedger, error: ledgerErr } = await adminSupabase
        .from('daily_ledgers')
        .upsert(ledgerPayload, { onConflict: 'branch_id,ledger_date' })
        .select('id')
        .single();
      if (ledgerErr) throw new Error(ledgerErr.message || 'Failed to update daily ledger');

      if (upsertedLedger?.id && txList) {
        await adminSupabase.from('daily_ledger_transactions').delete().eq('ledger_id', upsertedLedger.id);
        if (txList.length > 0) {
          await adminSupabase.from('daily_ledger_transactions').insert(
            txList.map((t) => ({
              ledger_id: upsertedLedger.id,
              transaction_type: String(t.transaction_type || 'LOAN_ISSUED'),
              bill_no: String(t.bill_no || t.loan_no || ''),
              amount: Number(t.amount ?? t.cash_loan ?? 0) || 0,
              weight_g: Number(t.weight_g || 0) || 0,
              weight_mg: Number(t.weight_mg || 0) || 0,
              insurance_rs: Number(t.insurance_rs || 0) || 0,
              item_code: String(t.item_code || ''),
              interest_rs: Number(t.interest_rs || 0) || 0,
              cash_received: Number(t.cash_received || 0) || 0,
              fs_type: String(t.fs_type || ''),
              redeem_no: String(t.redeem_no || ''),
              type_ir: String(t.type_ir || ''),
              quantity: t.quantity != null ? String(t.quantity) : null,
              remarks: String(t.remarks || ''),
            }))
          );
        }
      }
      if (upsertedLedger?.id && expList) {
        await adminSupabase.from('daily_ledger_expenses').delete().eq('ledger_id', upsertedLedger.id);
        if (expList.length > 0) {
          await adminSupabase.from('daily_ledger_expenses').insert(
            expList.map((e) => ({
              ledger_id: upsertedLedger.id,
              description: String(e.description || ''),
              amount: Number(e.amount || 0) || 0,
            }))
          );
        }
      }
    }
  } else if (entity_type === 'INTEREST') {
    if (action_type === 'DELETE' || action_type === 'VOID_INTEREST') {
      const { error: intDelErr } = await adminSupabase.from('stock_interests').delete().eq('id', entity_id);
      if (intDelErr) throw new Error(intDelErr.message || 'Failed to delete interest record');
      await invalidateBranchInventoryCache(sourceBranch);
    } else if (action_type === 'UPDATE') {
      const interestVal = parseFiniteNumber(proposed_data?.interest_value ?? proposed_data?.amount);
      if (interestVal !== undefined) {
        const { error: intUpdErr } = await adminSupabase
          .from('stock_interests')
          .update({ interest_value: interestVal })
          .eq('id', entity_id);
        if (intUpdErr) throw new Error(intUpdErr.message || 'Failed to update interest record');
        await invalidateBranchInventoryCache(sourceBranch);
      }
    }
  } else if (entity_type === 'CLIENT') {
    if (action_type === 'DELETE') {
      throw new Error(CUSTOMER_DELETE_BLOCK_MESSAGE);
    } else if (action_type === 'UPDATE') {
      const safeClient: ChangeRecordData = { ...(proposed_data || {}) };
      delete safeClient.id;
      delete safeClient.created_at;
      delete safeClient.updated_at;

      const { data: existingClient } = await adminSupabase
        .from('clients')
        .select('id, branch_id, national_id, first_name, last_name, phone, address')
        .eq('id', entity_id)
        .maybeSingle();

      if (existingClient) {
        const clientPatch: ChangeRecordData = {};
        if (safeClient.national_id !== undefined && String(safeClient.national_id).trim()) {
          clientPatch.national_id = String(safeClient.national_id).trim();
        }
        if (safeClient.first_name !== undefined && String(safeClient.first_name).trim()) {
          clientPatch.first_name = String(safeClient.first_name).trim();
        }
        if (safeClient.last_name !== undefined && String(safeClient.last_name).trim()) {
          clientPatch.last_name = String(safeClient.last_name).trim();
        }
        if (safeClient.phone !== undefined) clientPatch.phone = String(safeClient.phone).trim();
        if (safeClient.address !== undefined) clientPatch.address = String(safeClient.address).trim();
        if (safeClient.status !== undefined) clientPatch.status = String(safeClient.status);

        if (Object.keys(clientPatch).length > 0) {
          const { error: clientUpdErr } = await adminSupabase
            .from('clients')
            .update(clientPatch)
            .eq('id', entity_id);
          if (clientUpdErr) throw new Error(clientUpdErr.message || 'Failed to update client record');

          await syncClientAcrossModules({
            clientId: entity_id,
            branchId: existingClient.branch_id || sourceBranch,
            oldNationalId: existingClient.national_id,
            newNationalId: typeof clientPatch.national_id === 'string' ? clientPatch.national_id : existingClient.national_id,
            firstName: typeof clientPatch.first_name === 'string' ? clientPatch.first_name : existingClient.first_name,
            lastName: typeof clientPatch.last_name === 'string' ? clientPatch.last_name : existingClient.last_name,
            phone: typeof clientPatch.phone === 'string' ? clientPatch.phone : existingClient.phone,
            address: typeof clientPatch.address === 'string' ? clientPatch.address : existingClient.address,
            oldPhone: existingClient.phone,
            oldName: existingClient.first_name,
          });
        }
      } else {
        // Fallback if entity_id points to a legacy stock_customers row
        const { data: existingSc } = await adminSupabase
          .from('stock_customers')
          .select('id, branch_id, nic, name, tp, address')
          .eq('id', entity_id)
          .maybeSingle();
        if (!existingSc) {
          throw new Error('Target customer record could not be found.');
        }
        const scPatch: ChangeRecordData = {};
        if (safeClient.first_name !== undefined || safeClient.name !== undefined) {
          scPatch.name = String(safeClient.name || safeClient.first_name || '').trim();
        }
        if (safeClient.phone !== undefined || safeClient.tp !== undefined) {
          scPatch.tp = String(safeClient.tp || safeClient.phone || '').trim();
        }
        if (safeClient.address !== undefined) scPatch.address = String(safeClient.address).trim();
        if (safeClient.national_id !== undefined || safeClient.nic !== undefined) {
          scPatch.nic = String(safeClient.nic || safeClient.national_id || '').trim();
        }
        if (Object.keys(scPatch).length > 0) {
          const { error: scErr } = await adminSupabase
            .from('stock_customers')
            .update(scPatch)
            .eq('id', entity_id);
          if (scErr) throw new Error(scErr.message || 'Failed to update stock customer record');

          await syncStockCustomerToClients({
            branchId: existingSc.branch_id || sourceBranch,
            oldNic: existingSc.nic,
            newNic: typeof scPatch.nic === 'string' ? scPatch.nic : existingSc.nic,
            oldName: existingSc.name,
            oldPhone: existingSc.tp,
            name: typeof scPatch.name === 'string' ? scPatch.name : existingSc.name,
            tp: typeof scPatch.tp === 'string' ? scPatch.tp : existingSc.tp,
            address: typeof scPatch.address === 'string' ? scPatch.address : existingSc.address,
          });
        }
      }
    }
  }
}

export async function executeChangeTicketAction(
  session: AuthSession,
  ticketId: string,
  action: 'APPROVE' | 'REJECT' | 'UPDATE_PROPOSED',
  options?: { notes?: string; proposedData?: ChangeRecordData }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const userRole = (session?.role || '').toUpperCase();
  if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
    return {
      status: 403,
      body: { error: `Forbidden. Only Managers and Admins can modify or decide change request tickets.` }
    };
  }

  const { data: auditRow, error: fetchErr } = await adminSupabase
    .from('audit_logs')
    .select('*')
    .eq('id', ticketId)
    .eq('action', 'CHANGE_REQUEST')
    .maybeSingle();

  if (fetchErr || !auditRow) {
    return { status: 404, body: { error: 'Change request ticket not found' } };
  }

  const ticket: ChangeRequestTicket = auditRow.details;
  if (ticket.status !== 'PENDING') {
    return {
      status: 400,
      body: { error: `Ticket already ${ticket.status}. Cannot modify.` }
    };
  }

  const nowIso = new Date().toISOString();
  const managerEmail = session.user?.email || session.profile?.email || 'manager@branch';
  const managerName =
    session.user?.name ||
    session.user?.user_metadata?.name ||
    session.profile?.first_name ||
    managerEmail.split('@')[0] ||
    'Manager';

  const hasIncomingProposed = Boolean(options?.proposedData && Object.keys(options.proposedData).length > 0);
  const nextProposed = hasIncomingProposed
    ? normalizeProposedPayload(ticket.entity_type, ticket.proposed_data, options?.proposedData)
    : ticket.proposed_data;

  const isEditedByManager =
    hasIncomingProposed && JSON.stringify(nextProposed) !== JSON.stringify(ticket.proposed_data);

  const editAuditFields: Partial<ChangeRequestTicket> = isEditedByManager
    ? {
        original_proposed_data: ticket.original_proposed_data || ticket.proposed_data,
        proposed_data: nextProposed,
        edited_by_user_id: session.user?.id,
        edited_by_name: managerName,
        edited_by_role: userRole,
        edited_at: nowIso
      }
    : { proposed_data: nextProposed };

  if (action === 'UPDATE_PROPOSED') {
    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      ...editAuditFields,
      id: auditRow.id,
      updated_at: nowIso
    };

    const { error: updErr } = await adminSupabase
      .from('audit_logs')
      .update({
        branch_id: nextProposed?.branch_id ? String(nextProposed.branch_id) : auditRow.branch_id,
        details: updatedTicket
      })
      .eq('id', auditRow.id);

    if (updErr) throw updErr;

    return {
      status: 200,
      body: {
        success: true,
        message: `Ticket ${ticket.ticket_no} proposed values updated successfully.`,
        ticket: updatedTicket
      }
    };
  }

  if (action === 'APPROVE') {
    const requesterId = ticket.requested_by_user_id ? String(ticket.requested_by_user_id).trim() : '';
    const reviewerId = session.user?.id ? String(session.user.id).trim() : '';
    const requesterEmail = ticket.requested_by_email ? String(ticket.requested_by_email).trim().toLowerCase() : '';
    const reviewerEmail = session.user?.email ? String(session.user.email).trim().toLowerCase() : '';

    if ((requesterId && reviewerId && requesterId === reviewerId) || (!requesterId && requesterEmail && reviewerEmail && requesterEmail === reviewerEmail)) {
      return {
        status: 403,
        body: {
          error: 'Maker-Checker Violation: You cannot approve your own Change Request ticket. Another Manager or Admin must approve it.'
        }
      };
    }

    const ticketWithEdits: ChangeRequestTicket = {
      ...ticket,
      ...editAuditFields,
      id: auditRow.id
    };

    const reviewNotes = (options?.notes || 'Approved by Manager').trim();
    await applyApprovedChange(ticketWithEdits, {
      name: managerName,
      email: managerEmail
    });

    const updatedTicket: ChangeRequestTicket = {
      ...ticketWithEdits,
      status: 'APPROVED',
      reviewed_by_user_id: session.user?.id,
      reviewed_by_name: managerName,
      reviewed_by_role: userRole,
      reviewed_at: nowIso,
      review_notes: reviewNotes,
      updated_at: nowIso
    };

    const { error: updErr } = await adminSupabase
      .from('audit_logs')
      .update({
        branch_id: nextProposed?.branch_id ? String(nextProposed.branch_id) : auditRow.branch_id,
        details: updatedTicket
      })
      .eq('id', auditRow.id);

    if (updErr) throw updErr;

    return {
      status: 200,
      body: {
        success: true,
        message: `Ticket ${ticket.ticket_no} approved and changes applied successfully.`,
        ticket: updatedTicket
      }
    };
  }

  const reviewNotes = (options?.notes || 'Rejected by Manager').trim();
  const updatedTicket: ChangeRequestTicket = {
    ...ticket,
    id: auditRow.id,
    status: 'REJECTED',
    reviewed_by_user_id: session.user?.id,
    reviewed_by_name: managerName,
    reviewed_by_role: userRole,
    reviewed_at: nowIso,
    review_notes: reviewNotes,
    updated_at: nowIso
  };

  const { error: updErr } = await adminSupabase
    .from('audit_logs')
    .update({ details: updatedTicket })
    .eq('id', auditRow.id);

  if (updErr) throw updErr;

  return {
    status: 200,
    body: {
      success: true,
      message: `Ticket ${ticket.ticket_no} marked as REJECTED.`,
      ticket: updatedTicket
    }
  };
}
