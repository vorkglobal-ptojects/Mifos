import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import { getSriLankaDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);

    const body = await req.json();
    const { id, restoreDate, interestPaid, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    // Direct restore prohibited for TELLER
    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct stock restore to safe is prohibited for Tellers. Please submit a Change Request Ticket for Manager approval.' 
      }, { status: 403 });
    }

    // 1. Fetch item from stock_items
    const { data: item, error: fetchErr } = await adminSupabase
      .from('stock_items')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
    }

    // 2. Format history notes
    const todayStr = restoreDate || getSriLankaDate();
    const interestVal = parseFloat(interestPaid) || 0;
    const interestStr = interestVal > 0 ? `Interest Paid: Rs. ${interestVal.toLocaleString('en-US')}` : 'Interest Paid: N/A';
    const cleanNotes = (notes || '').trim();
    
    const restoreHistoryLine = `[RESTORED TO SAFE on ${todayStr}] ${interestStr}${cleanNotes ? ' | Notes: ' + cleanNotes : ''}`;
    const previousNotes = item.withdrawal_notes || '';
    const updatedNotes = previousNotes ? `${previousNotes}\n${restoreHistoryLine}` : restoreHistoryLine;

    // 3. Update stock_items back to Active status
    const { data: updatedItem, error: updateErr } = await adminSupabase
      .from('stock_items')
      .update({
        status: 'Active',
        withdrawal_date: null,
        withdrawal_reason: null,
        withdrawal_notes: updatedNotes
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      throw new Error("Failed to restore stock item: " + updateErr.message);
    }

    // 4. Update matching Pawn Ticket in 'pawns' table if exists
    try {
      if (item.bill_no) {
        await adminSupabase
          .from('pawns')
          .update({
            status: 'ACTIVE',
            updated_at: new Date().toISOString()
          })
          .ilike('bill_no', item.bill_no.trim());
      }
    } catch (pawnErr) {
      console.warn("Matching pawn ticket status update notice:", pawnErr);
    }

    // 5. Record Audit Log
    if (session) {
      await recordAuditLog(session, {
        action: 'STOCK_RESTORE_TO_SAFE',
        resource: `stock_items:${item.bill_no || id}`,
        details: {
          bill_no: item.bill_no,
          branch_id: item.branch_id,
          interest_paid: interestVal,
          restore_date: todayStr,
          notes: cleanNotes
        }
      });
    }

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache(item.branch_id || 'ALL');
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({
      success: true,
      message: `Bill ${item.bill_no} successfully restored to Active Safe Stock!`,
      item: updatedItem
    });

  } catch (err: any) {
    console.error("Error in /api/stock/restore:", err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
