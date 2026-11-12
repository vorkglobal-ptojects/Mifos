import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { invalidateBranchInventoryCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// PUT: Edit an item in Daily Matrix
export async function PUT(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot modify matrix transactions.' }, { status: 403 });
    }

    const body = await req.json();
    const { id, category, bill_no, date, amount, branch, notes, remarks, user_id } = body;

    if (!id || !category) {
      return NextResponse.json({ error: 'Missing required params: id, category' }, { status: 400 });
    }

    if (!adminSupabase) {
      return NextResponse.json({ error: 'Supabase client not initialized' }, { status: 500 });
    }

    let updateResult: any;

    if (category === 'INTEREST') {
      const { data, error } = await adminSupabase
        .from('stock_interests')
        .update({
          date: date,
          interest_value: parseFloat(amount) || 0,
          branch: (branch || 'DMT').toUpperCase(),
          notes: notes || remarks || ''
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      updateResult = data;
    } else if (category === 'FS') {
      const { data, error } = await adminSupabase
        .from('daily_ledger_transactions')
        .update({
          insurance_rs: parseFloat(amount) || 0,
          remarks: remarks || notes || 'Updated F/S fee'
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      updateResult = data;
    } else if (category === 'RECEIPT') {
      const { data, error } = await adminSupabase
        .from('daily_ledger_transactions')
        .update({
          cash_received: parseFloat(amount) || 0,
          remarks: remarks || notes || 'Updated receipt'
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      updateResult = data;
    } else if (category === 'LOAN' || category === 'REDEEM') {
      const { data, error } = await adminSupabase
        .from('stock_items')
        .update({
          price: parseFloat(amount) || 0,
          date: date,
          branch_id: (branch || 'DMT').toUpperCase()
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      updateResult = data;
    }

    // Log action to audit_logs
    try {
      await adminSupabase.from('audit_logs').insert([{
        action: 'UPDATE_STOCK_MATRIX_ITEM',
        resource: `category:${category}:${id}`,
        details: JSON.stringify({ category, bill_no, amount, branch, user_id }),
        created_at: new Date().toISOString()
      }]);
    } catch (e) {}

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache(branch || 'ALL', date);
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ success: true, data: updateResult });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update item' }, { status: 500 });
  }
}

// DELETE: Delete an item from Daily Matrix
export async function DELETE(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (session.role === 'TELLER' || session.role === 'AUDITOR') {
      return NextResponse.json({
        error: 'Direct matrix item deletion is strictly prohibited for this role. Please submit a Change Request Ticket.'
      }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const category = searchParams.get('category');

    if (!id || !category) {
      return NextResponse.json({ error: 'Missing required params: id, category' }, { status: 400 });
    }

    if (!adminSupabase) {
      return NextResponse.json({ error: 'Supabase client not initialized' }, { status: 500 });
    }

    if (category === 'INTEREST') {
      const { error } = await adminSupabase.from('stock_interests').delete().eq('id', id);
      if (error) throw error;
    } else if (category === 'FS' || category === 'RECEIPT') {
      const { error } = await adminSupabase.from('daily_ledger_transactions').delete().eq('id', id);
      if (error) throw error;
    } else if (category === 'LOAN' || category === 'REDEEM') {
      const { error } = await adminSupabase.from('stock_items').delete().eq('id', id);
      if (error) throw error;
    }

    // Log action to audit_logs
    try {
      await adminSupabase.from('audit_logs').insert([{
        action: 'DELETE_STOCK_MATRIX_ITEM',
        resource: `category:${category}:${id}`,
        details: JSON.stringify({ category, id }),
        created_at: new Date().toISOString()
      }]);
    } catch (e) {}

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache('ALL');
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ success: true, message: 'Item deleted successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to delete item' }, { status: 500 });
  }
}
