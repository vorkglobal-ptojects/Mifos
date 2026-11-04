import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { oldSupabase } from '@/lib/old-supabase-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { invalidateBranchInventoryCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);

    const { id, bill_no, isOld } = await req.json();
    if (!id && !bill_no) {
      return NextResponse.json({ error: 'Item ID or Bill Number is required' }, { status: 400 });
    }

    const client = isOld ? oldSupabase : adminSupabase;

    // 1. Fetch item details to verify branch permission & log
    let query = client.from('stock_items').select('*');
    if (id) {
      query = query.eq('id', id);
    } else if (bill_no) {
      query = query.ilike('bill_no', bill_no.trim());
    }
    const { data: existingItems } = await query;
    const existingItem = existingItems && existingItems.length > 0 ? existingItems[0] : null;

    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct stock deletion is strictly prohibited for Tellers. Please submit a Change Request Ticket for Manager/Admin approval.' 
      }, { status: 403 });
    }

    // 2. Perform deletion from stock_items by ID first, then by bill_no fallback
    let deleteResult;
    if (id) {
      deleteResult = await client
        .from('stock_items')
        .delete()
        .eq('id', id)
        .select();
    }

    if ((!deleteResult || !deleteResult.data || deleteResult.data.length === 0) && bill_no) {
      deleteResult = await client
        .from('stock_items')
        .delete()
        .ilike('bill_no', bill_no.trim())
        .select();
    }

    if (deleteResult?.error) {
      console.error("[Stock Delete Error]:", deleteResult.error);
      return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
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
