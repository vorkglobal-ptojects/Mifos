import { adminSupabase } from './auth-server';
import { normalizeBranchId, stripBranchPrefix } from './branch-mapping';
import { invalidateBranchInventoryCache } from './redis';

export type ChangeEntityType = 'PAWN' | 'STOCK' | 'DAILY_LEDGER' | 'INTEREST' | 'CLIENT';
export type ChangeActionType = 'UPDATE' | 'DELETE' | 'RESTORE' | 'LEDGER_ADJUST' | 'VOID_INTEREST';
export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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
  current_data: Record<string, any>;
  proposed_data: Record<string, any>;
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

// Apply approved changes to live database
export async function applyApprovedChange(ticket: ChangeRequestTicket, reviewer: any) {
  const { entity_type, action_type, entity_id, proposed_data, current_data, branch_id } = ticket;

  if (entity_type === 'PAWN') {
    if (action_type === 'DELETE') {
      // 1. Delete from pawns
      await adminSupabase.from('pawns').delete().eq('id', entity_id);
      // 2. Delete matching stock_item if exists
      if (ticket.reference_no) {
        await adminSupabase.from('stock_items').delete().eq('bill_no', ticket.reference_no);
      }
      await invalidateBranchInventoryCache(branch_id);
    } else if (action_type === 'UPDATE') {
      const pawnUpdate: Record<string, any> = {};
      if (proposed_data.disbursed_amount !== undefined) pawnUpdate.disbursed_amount = parseFloat(proposed_data.disbursed_amount);
      if (proposed_data.appraised_value !== undefined) pawnUpdate.appraised_value = parseFloat(proposed_data.appraised_value);
      if (proposed_data.description !== undefined) pawnUpdate.description = proposed_data.description;
      if (proposed_data.bill_no !== undefined) pawnUpdate.bill_no = proposed_data.bill_no;
      if (proposed_data.weight_grams !== undefined) pawnUpdate.weight_grams = parseFloat(proposed_data.weight_grams);
      if (proposed_data.weight_mg !== undefined) pawnUpdate.weight_mg = parseFloat(proposed_data.weight_mg);

      const { error: pawnErr } = await adminSupabase.from('pawns').update(pawnUpdate).eq('id', entity_id);
      if (pawnErr) {
        console.error('Error updating pawn:', pawnErr);
        throw new Error(pawnErr.message || 'Failed to update pawn loan record');
      }

      // Sync stock_items if weight or price or bill changed
      const billToMatch = current_data.bill_no || ticket.reference_no;
      if (billToMatch) {
        const stockUpdate: Record<string, any> = {};
        if (pawnUpdate.appraised_value !== undefined) stockUpdate.price = pawnUpdate.appraised_value;
        if (pawnUpdate.bill_no !== undefined) stockUpdate.bill_no = stripBranchPrefix(pawnUpdate.bill_no);
        if (pawnUpdate.weight_grams !== undefined) stockUpdate.weight = pawnUpdate.weight_grams;

        if (Object.keys(stockUpdate).length > 0) {
          await adminSupabase.from('stock_items').update(stockUpdate).eq('bill_no', billToMatch).eq('branch_id', branch_id);
        }
      }
      await invalidateBranchInventoryCache(branch_id);
    }
  } else if (entity_type === 'STOCK') {
    if (action_type === 'DELETE') {
      const { error: stockDelErr } = await adminSupabase.from('stock_items').delete().eq('id', entity_id);
      if (stockDelErr) throw new Error(stockDelErr.message);
      await invalidateBranchInventoryCache(branch_id);
    } else if (action_type === 'RESTORE') {
      const todayStr = new Date().toISOString().split('T')[0];
      const interestVal = parseFloat(proposed_data.interest_paid) || 0;
      const cleanNotes = (proposed_data.notes || '').trim();
      const restoreLine = `[APPROVED RESTORE TO SAFE on ${todayStr} by ${reviewer.name || reviewer.email}] Interest: Rs. ${interestVal}${cleanNotes ? ' | ' + cleanNotes : ''}`;
      
      const { data: currentStock } = await adminSupabase.from('stock_items').select('withdrawal_notes, bill_no').eq('id', entity_id).single();
      const updatedNotes = currentStock?.withdrawal_notes ? `${currentStock.withdrawal_notes}\n${restoreLine}` : restoreLine;

      const { error: stockUpErr } = await adminSupabase.from('stock_items').update({
        status: 'Active',
        withdrawal_date: null,
        withdrawal_reason: null,
        withdrawal_notes: updatedNotes
      }).eq('id', entity_id);
      if (stockUpErr) throw new Error(stockUpErr.message);

      if (currentStock?.bill_no) {
        await adminSupabase.from('pawns').update({ status: 'ACTIVE' }).ilike('bill_no', currentStock.bill_no.trim());
      }
      await invalidateBranchInventoryCache(branch_id);
    } else if (action_type === 'UPDATE') {
      const stockUpdate: Record<string, any> = {};
      if (proposed_data.price !== undefined) stockUpdate.price = parseFloat(proposed_data.price);
      if (proposed_data.weight !== undefined) stockUpdate.weight = parseFloat(proposed_data.weight);
      if (proposed_data.item_type !== undefined) stockUpdate.item_type = proposed_data.item_type;
      if (proposed_data.bill_no !== undefined) stockUpdate.bill_no = stripBranchPrefix(proposed_data.bill_no);
      if (proposed_data.date !== undefined) stockUpdate.date = proposed_data.date;

      await adminSupabase.from('stock_items').update(stockUpdate).eq('id', entity_id);
      await invalidateBranchInventoryCache(branch_id);
    }
  } else if (entity_type === 'DAILY_LEDGER') {
    // Apply ledger modifications
    const ledgerPayload: Record<string, any> = { ...proposed_data, updated_at: new Date().toISOString() };
    await adminSupabase
      .from('daily_ledgers')
      .upsert(ledgerPayload, { onConflict: 'branch_id,ledger_date' });
  } else if (entity_type === 'INTEREST') {
    if (action_type === 'DELETE' || action_type === 'VOID_INTEREST') {
      await adminSupabase.from('stock_interests').delete().eq('id', entity_id);
      await invalidateBranchInventoryCache(branch_id);
    }
  } else if (entity_type === 'CLIENT') {
    if (action_type === 'DELETE') {
      await adminSupabase.from('clients').delete().eq('id', entity_id);
    } else if (action_type === 'UPDATE') {
      await adminSupabase.from('clients').update(proposed_data).eq('id', entity_id);
    }
  }
}
