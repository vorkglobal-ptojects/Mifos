import { adminSupabase, AuthSession } from './auth-server';
import { normalizeBranchId, stripBranchPrefix, getBranchSearchTerms, generateUniqueOrderTag } from './branch-mapping';
import { invalidateBranchInventoryCache } from './redis';

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
    const branchTerms = getBranchSearchTerms(sourceBranch);
    if (action_type === 'DELETE') {
      // 1. Delete from pawns
      const { error: pawnDelErr } = await adminSupabase.from('pawns').delete().eq('id', entity_id);
      if (pawnDelErr) throw new Error(pawnDelErr.message || 'Failed to delete pawn ticket');
      // 2. Delete matching stock_item strictly within source branch
      if (ticket.reference_no) {
        const cleanRef = stripBranchPrefix(String(ticket.reference_no));
        const { error: stockDelErr } = await adminSupabase
          .from('stock_items')
          .delete()
          .in('branch_id', branchTerms)
          .or(`bill_no.eq."${ticket.reference_no}",bill_no.eq."${cleanRef}"`);
        if (stockDelErr) throw new Error(stockDelErr.message || 'Failed to delete linked stock item');
      }
      await invalidateBranchInventoryCache(sourceBranch);
    } else if (action_type === 'UPDATE') {
      const pawnUpdate: ChangeRecordData = {};
      const disbursed = parseFiniteNumber(proposed_data.disbursed_amount);
      const appraised = parseFiniteNumber(proposed_data.appraised_value);
      const weightGrams = parseFiniteNumber(proposed_data.weight_grams);
      const weightMg = parseFiniteNumber(proposed_data.weight_mg);
      const periodMonths = parseFiniteNumber(proposed_data.period_months);

      if (disbursed !== undefined) pawnUpdate.disbursed_amount = disbursed;
      if (appraised !== undefined) pawnUpdate.appraised_value = appraised;
      if (periodMonths !== undefined && periodMonths > 0) {
        pawnUpdate.period_months = Math.round(periodMonths);
      }
      if (proposed_data.description !== undefined) pawnUpdate.description = proposed_data.description;
      if (proposed_data.bill_no !== undefined && String(proposed_data.bill_no).trim() !== '') {
        pawnUpdate.bill_no = stripBranchPrefix(String(proposed_data.bill_no));
      }
      if (weightGrams !== undefined) {
        pawnUpdate.weight_grams = weightGrams;
        if (weightMg === undefined) pawnUpdate.weight_mg = Math.round(weightGrams * 1000);
      }
      if (weightMg !== undefined) {
        pawnUpdate.weight_mg = weightMg;
        if (weightGrams === undefined) pawnUpdate.weight_grams = weightMg / 1000;
      }
      if (proposed_data.branch_id !== undefined && String(proposed_data.branch_id).trim() !== '') {
        pawnUpdate.branch_id = normalizeBranchId(String(proposed_data.branch_id));
      }

      if (pawnUpdate.bill_no !== undefined || pawnUpdate.branch_id !== undefined) {
        const { data: existingPawn } = await adminSupabase
          .from('pawns')
          .select('client_id, branch_id, bill_no')
          .eq('id', entity_id)
          .maybeSingle();
        let nicForTag = String(current_data?.national_id || '');
        const cId = existingPawn?.client_id;
        if (!nicForTag && cId) {
          const { data: cRow } = await adminSupabase
            .from('clients')
            .select('national_id')
            .eq('id', cId)
            .maybeSingle();
          nicForTag = cRow?.national_id || '';
        }
        const effBranch = String(pawnUpdate.branch_id || existingPawn?.branch_id || sourceBranch);
        const effBill = String(pawnUpdate.bill_no || existingPawn?.bill_no || ticket.reference_no || '');
        pawnUpdate.unique_tag = generateUniqueOrderTag(effBranch, nicForTag, effBill);
      }

      if (Object.keys(pawnUpdate).length > 0) {
        const { error: pawnErr } = await adminSupabase.from('pawns').update(pawnUpdate).eq('id', entity_id);
        if (pawnErr) {
          console.error('Error updating pawn:', pawnErr);
          throw new Error(pawnErr.message || 'Failed to update pawn loan record');
        }
      }

      // Sync stock_items if weight or price or bill changed
      const billToMatch = stripBranchPrefix(String(current_data?.bill_no || ticket.reference_no || ''));
      const targetBranch = typeof pawnUpdate.branch_id === 'string' ? pawnUpdate.branch_id : sourceBranch;
      if (billToMatch) {
        const stockUpdate: ChangeRecordData = {};
        if (pawnUpdate.disbursed_amount !== undefined) stockUpdate.price = pawnUpdate.disbursed_amount;
        else if (pawnUpdate.appraised_value !== undefined) stockUpdate.price = pawnUpdate.appraised_value;
        if (typeof pawnUpdate.bill_no === 'string') stockUpdate.bill_no = stripBranchPrefix(pawnUpdate.bill_no);
        if (pawnUpdate.weight_grams !== undefined) stockUpdate.weight = pawnUpdate.weight_grams;
        if (pawnUpdate.branch_id !== undefined) stockUpdate.branch_id = pawnUpdate.branch_id;

        if (Object.keys(stockUpdate).length > 0) {
          const { error: stockSyncErr } = await adminSupabase
            .from('stock_items')
            .update(stockUpdate)
            .ilike('bill_no', billToMatch)
            .in('branch_id', branchTerms);
          if (stockSyncErr) {
            throw new Error(stockSyncErr.message || 'Failed to sync linked stock item');
          }
        }
      }
      await invalidateBranchInventoryCache(sourceBranch);
      if (targetBranch !== sourceBranch) {
        await invalidateBranchInventoryCache(targetBranch);
      }
    }
  } else if (entity_type === 'STOCK') {
    if (action_type === 'DELETE') {
      const { error: stockDelErr } = await adminSupabase.from('stock_items').delete().eq('id', entity_id);
      if (stockDelErr) throw new Error(stockDelErr.message);
      await invalidateBranchInventoryCache(sourceBranch);
    } else if (action_type === 'RESTORE') {
      const todayStr = new Date().toISOString().split('T')[0];
      const rawInterest = proposed_data.interest_paid ?? proposed_data.interest_amount ?? 0;
      const interestVal = parseFloat(String(rawInterest)) || 0;
      const cleanNotes = String(proposed_data.notes || '').trim();
      const restoreLine = `[APPROVED RESTORE TO SAFE on ${todayStr} by ${reviewer.name || reviewer.email}] Interest: Rs. ${interestVal}${cleanNotes ? ' | ' + cleanNotes : ''}`;
      
      const { data: currentStock, error: fetchStockErr } = await adminSupabase
        .from('stock_items')
        .select('withdrawal_notes, bill_no, branch_id')
        .eq('id', entity_id)
        .single();
      if (fetchStockErr) throw new Error(fetchStockErr.message || 'Stock item not found for restore');
      const updatedNotes = currentStock?.withdrawal_notes ? `${currentStock.withdrawal_notes}\n${restoreLine}` : restoreLine;
      const stockBranch = normalizeBranchId(String(currentStock?.branch_id || sourceBranch));

      const { error: stockUpErr } = await adminSupabase.from('stock_items').update({
        status: 'Active',
        withdrawal_date: null,
        withdrawal_reason: null,
        withdrawal_notes: updatedNotes
      }).eq('id', entity_id);
      if (stockUpErr) throw new Error(stockUpErr.message);

      if (currentStock?.bill_no) {
        const cleanStockBill = stripBranchPrefix(currentStock.bill_no.trim());
        const { error: pawnRestoreErr } = await adminSupabase
          .from('pawns')
          .update({ status: 'ACTIVE' })
          .in('branch_id', getBranchSearchTerms(stockBranch))
          .or(`bill_no.ilike."${currentStock.bill_no.trim()}",bill_no.ilike."${cleanStockBill}"`);
        if (pawnRestoreErr) throw new Error(pawnRestoreErr.message || 'Failed to restore linked pawn status');
      }
      await invalidateBranchInventoryCache(stockBranch);
    } else if (action_type === 'UPDATE') {
      const stockUpdate: ChangeRecordData = {};
      const parsedPrice = parseFiniteNumber(proposed_data.price);
      const parsedWeight = parseFiniteNumber(proposed_data.weight);

      if (parsedPrice !== undefined) stockUpdate.price = parsedPrice;
      if (parsedWeight !== undefined) stockUpdate.weight = parsedWeight;
      if (proposed_data.item_type !== undefined) stockUpdate.item_type = String(proposed_data.item_type);
      if (proposed_data.bill_no !== undefined && String(proposed_data.bill_no).trim() !== '') {
        stockUpdate.bill_no = stripBranchPrefix(String(proposed_data.bill_no));
      }
      if (proposed_data.date !== undefined && String(proposed_data.date).trim() !== '') {
        stockUpdate.date = String(proposed_data.date);
      }
      if (proposed_data.branch_id !== undefined && String(proposed_data.branch_id).trim() !== '') {
        stockUpdate.branch_id = normalizeBranchId(String(proposed_data.branch_id));
      }

      if (Object.keys(stockUpdate).length > 0) {
        const { error: stockUpdErr } = await adminSupabase.from('stock_items').update(stockUpdate).eq('id', entity_id);
        if (stockUpdErr) throw new Error(stockUpdErr.message);
      }

      // Sync corresponding pawn record strictly within source branch if price, weight, bill_no, or branch_id changed
      const billToMatch = stripBranchPrefix(String(current_data?.bill_no || ticket.reference_no || ''));
      const targetBranch = typeof stockUpdate.branch_id === 'string' ? stockUpdate.branch_id : sourceBranch;
      if (billToMatch) {
        const pawnUpdate: ChangeRecordData = {};
        if (typeof stockUpdate.price === 'number') {
          pawnUpdate.disbursed_amount = stockUpdate.price;
        }
        if (typeof stockUpdate.weight === 'number') {
          pawnUpdate.weight_grams = stockUpdate.weight;
          pawnUpdate.weight_mg = Math.round(stockUpdate.weight * 1000);
        }
        if (stockUpdate.bill_no !== undefined) {
          pawnUpdate.bill_no = stockUpdate.bill_no;
        }
        if (stockUpdate.branch_id !== undefined) {
          pawnUpdate.branch_id = stockUpdate.branch_id;
        }
        if (stockUpdate.bill_no !== undefined || stockUpdate.branch_id !== undefined) {
          const { data: matchedPawns } = await adminSupabase
            .from('pawns')
            .select('id, client_id, branch_id, bill_no')
            .ilike('bill_no', billToMatch)
            .in('branch_id', getBranchSearchTerms(sourceBranch))
            .limit(1);
          const matchedPawn = matchedPawns?.[0];
          if (matchedPawn) {
            let clientNic = '';
            if (matchedPawn.client_id) {
              const { data: cRow } = await adminSupabase
                .from('clients')
                .select('national_id')
                .eq('id', matchedPawn.client_id)
                .maybeSingle();
              clientNic = cRow?.national_id || '';
            }
            const effBranch = String(pawnUpdate.branch_id || matchedPawn.branch_id || sourceBranch);
            const effBill = String(pawnUpdate.bill_no || matchedPawn.bill_no || billToMatch);
            pawnUpdate.unique_tag = generateUniqueOrderTag(effBranch, clientNic, effBill);
          }
        }
        if (Object.keys(pawnUpdate).length > 0) {
          const { error: pawnSyncErr } = await adminSupabase
            .from('pawns')
            .update(pawnUpdate)
            .ilike('bill_no', billToMatch)
            .in('branch_id', getBranchSearchTerms(sourceBranch));
          if (pawnSyncErr) throw new Error(pawnSyncErr.message || 'Failed to sync linked pawn ticket');
        }
      }

      await invalidateBranchInventoryCache(sourceBranch);
      if (targetBranch !== sourceBranch) {
        await invalidateBranchInventoryCache(targetBranch);
      }
    }
  } else if (entity_type === 'DAILY_LEDGER') {
    const safePayload: ChangeRecordData = { ...(proposed_data || {}) };
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
    const { error: ledgerErr } = await adminSupabase
      .from('daily_ledgers')
      .upsert(ledgerPayload, { onConflict: 'branch_id,ledger_date' });
    if (ledgerErr) throw new Error(ledgerErr.message || 'Failed to update daily ledger');
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
      const { error: clientDelErr } = await adminSupabase.from('clients').delete().eq('id', entity_id);
      if (clientDelErr) throw new Error(clientDelErr.message || 'Failed to delete client record');
    } else if (action_type === 'UPDATE') {
      const safeClient: ChangeRecordData = { ...(proposed_data || {}) };
      delete safeClient.id;
      delete safeClient.created_at;
      delete safeClient.updated_at;
      if (Object.keys(safeClient).length > 0) {
        const { error: clientUpdErr } = await adminSupabase.from('clients').update(safeClient).eq('id', entity_id);
        if (clientUpdErr) throw new Error(clientUpdErr.message || 'Failed to update client record');
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
