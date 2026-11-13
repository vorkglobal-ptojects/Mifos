import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { getSriLankaDate } from '@/lib/date-utils';
import { syncPawnAndStockRestore } from '@/lib/cross-sync';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({
        error: 'Direct stock restore to safe is prohibited for this role. Please submit a Change Request Ticket for Manager approval.'
      }, { status: 403 });
    }

    const body = await req.json();
    const { id, restoreDate, interestPaid, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
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

    // 3. Synchronized Restore across stock_items, pawns (clearing redeemed_*), daily_ledgers & caches
    await syncPawnAndStockRestore({
      branchId: item.branch_id,
      stockId: id,
      billNo: item.bill_no,
      allowLockedLedger: session.role === 'ADMIN',
      actorSession: session,
      reason: restoreHistoryLine,
    });

    const { data: updatedItem } = await adminSupabase
      .from('stock_items')
      .update({ withdrawal_notes: updatedNotes })
      .eq('id', id)
      .select()
      .single();

    // 4. Record Audit Log
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
