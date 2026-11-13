import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { oldSupabase } from '@/lib/old-supabase-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import { getBranchSearchTerms, normalizeBranchId, stripBranchPrefix } from '@/lib/branch-mapping';
import { syncPawnAndStockDelete } from '@/lib/cross-sync';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({
        error: 'Direct stock deletion is strictly prohibited for this role. Please submit a Change Request Ticket for Manager/Admin approval.'
      }, { status: 403 });
    }

    const { id, bill_no, branch_id, isOld } = await req.json();
    if (!id && !bill_no) {
      return NextResponse.json({ error: 'Item ID or Bill Number is required' }, { status: 400 });
    }

    const client = isOld ? oldSupabase : adminSupabase;

    // 1. Fetch item details to verify branch scoping and avoid cross-branch bill_no collision
    let query = client.from('stock_items').select('*');
    if (id) {
      query = query.eq('id', id);
    } else if (bill_no) {
      const cleanBill = stripBranchPrefix(String(bill_no).trim());
      query = query.or(`bill_no.ilike."${String(bill_no).trim()}",bill_no.ilike."${cleanBill}"`);
      if (branch_id) {
        query = query.in('branch_id', getBranchSearchTerms(String(branch_id)));
      }
    }
    const { data: existingItems } = await query.limit(5);
    if (!id && existingItems && existingItems.length > 1) {
      return NextResponse.json({
        error: 'Multiple stock items across branches match this bill number. Please provide item ID or branch_id.'
      }, { status: 400 });
    }
    const existingItem = existingItems && existingItems.length > 0 ? existingItems[0] : null;

    // 2. Perform synchronized cross-module deletion for main database or legacy delete for oldSupabase
    let deleteResult;
    if (isOld) {
      if (id) {
        deleteResult = await client.from('stock_items').delete().eq('id', id).select();
      } else if (existingItem?.id) {
        deleteResult = await client.from('stock_items').delete().eq('id', existingItem.id).select();
      } else if (bill_no && branch_id) {
        deleteResult = await client
          .from('stock_items')
          .delete()
          .ilike('bill_no', String(bill_no).trim())
          .in('branch_id', getBranchSearchTerms(normalizeBranchId(String(branch_id))))
          .select();
      }

      if (deleteResult?.error) {
        console.error("[Stock Delete Error]:", deleteResult.error);
        return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
      }
    } else {
      await syncPawnAndStockDelete({
        branchId: existingItem?.branch_id || branch_id,
        stockId: existingItem?.id || id,
        billNo: existingItem?.bill_no || bill_no,
        allowLockedLedger: session.role === 'ADMIN',
        actorSession: session,
        reason: 'Direct stock item delete',
      });
    }

    // 3. Record Audit Log
    if (session) {
      await recordAuditLog(session, {
        action: 'STOCK_DELETE_ITEM',
        resource: `stock_items:${bill_no || id}`,
        details: {
          id,
          bill_no: bill_no || existingItem?.bill_no,
          branch_id: existingItem?.branch_id || 'HQ',
          is_old_data: !!isOld
        }
      });
    }

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache(existingItem?.branch_id || 'ALL');
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ 
      success: true, 
      message: `Stock item "${bill_no || id}" permanently deleted.`,
      deleted: deleteResult?.data 
    });

  } catch (err: any) {
    console.error("Server Error in /api/stock/delete:", err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
