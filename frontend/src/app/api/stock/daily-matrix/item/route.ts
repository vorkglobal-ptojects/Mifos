import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import { normalizeBranchId } from '@/lib/branch-mapping';
import {
  applyLedgerTotalsDelta,
  syncPawnAndStockUpdate,
  syncPawnAndStockDelete,
} from '@/lib/cross-sync';

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

    const sessionBranch = normalizeBranchId(session.branchId || 'HQ');
    const isGlobal = session.role === 'ADMIN' || sessionBranch === 'HQ';
    let targetBranch = normalizeBranchId(branch || session.branchId || 'HQ');
    let updateResult: any;

    if (category === 'INTEREST') {
      const { data, error } = await adminSupabase
        .from('stock_interests')
        .update({
          date: date,
          interest_value: parseFloat(amount) || 0,
          branch: targetBranch,
          notes: notes || remarks || ''
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      updateResult = data;
    } else if (category === 'FS' || category === 'RECEIPT') {
      const { data: existingTx } = await adminSupabase
        .from('daily_ledger_transactions')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      const nextVal = parseFloat(amount) || 0;
      const patch =
        category === 'FS'
          ? { insurance_rs: nextVal, remarks: remarks || notes || 'Updated F/S fee' }
          : { cash_received: nextVal, remarks: remarks || notes || 'Updated receipt' };

      const { data, error } = await adminSupabase
        .from('daily_ledger_transactions')
        .update(patch)
        .eq('id', id)
        .select();

      if (error) throw error;
      updateResult = data;

      if (existingTx?.ledger_id) {
        const deltaInsurance =
          category === 'FS' ? nextVal - Number(existingTx.insurance_rs || 0) : 0;
        const deltaRedeem =
          category === 'RECEIPT' ? nextVal - Number(existingTx.cash_received || 0) : 0;
        await applyLedgerTotalsDelta({
          ledgerId: existingTx.ledger_id,
          deltaInsurance,
          deltaRedeem,
          allowLockedLedger: session.role === 'ADMIN',
          actorSession: session,
          reason: `Matrix ${category} item update`,
        });
      }
    } else if (category === 'LOAN' || category === 'REDEEM') {
      const { data: existingStock } = await adminSupabase
        .from('stock_items')
        .select('id, branch_id, bill_no')
        .eq('id', id)
        .maybeSingle();
      if (!existingStock) {
        return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
      }
      targetBranch = normalizeBranchId(branch || existingStock.branch_id || sessionBranch);
      if (!isGlobal && normalizeBranchId(existingStock.branch_id) !== sessionBranch) {
        return NextResponse.json({ error: 'Forbidden. Cross-branch modification denied.' }, { status: 403 });
      }

      const { stock } = await syncPawnAndStockUpdate({
        source: 'STOCK',
        stockId: id,
        branchId: existingStock.branch_id,
        updates: {
          price: parseFloat(amount) || 0,
          ...(date ? { date } : {}),
          ...(branch ? { branch_id: targetBranch } : {}),
        },
        allowLockedLedger: session.role === 'ADMIN',
        actorSession: session,
        reason: `Matrix ${category} item update`,
      });
      updateResult = stock ? [stock] : [];
    }

    // Log action to audit_logs
    try {
      await adminSupabase.from('audit_logs').insert([{
        action: 'UPDATE_STOCK_MATRIX_ITEM',
        resource: `category:${category}:${id}`,
        branch_id: targetBranch,
        details: JSON.stringify({ category, bill_no, amount, branch: targetBranch, user_id }),
        created_at: new Date().toISOString()
      }]);
    } catch (e) {}

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache(targetBranch || 'ALL', date);
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ success: true, data: updateResult });
  } catch (err: any) {
    const msg = err?.message || 'Failed to update item';
    return NextResponse.json({ error: msg }, { status: msg.includes('LOCKED') ? 403 : 500 });
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

    const sessionBranch = normalizeBranchId(session.branchId || 'HQ');
    const isGlobal = session.role === 'ADMIN' || sessionBranch === 'HQ';

    if (category === 'INTEREST') {
      const { error } = await adminSupabase.from('stock_interests').delete().eq('id', id);
      if (error) throw error;
    } else if (category === 'FS' || category === 'RECEIPT') {
      const { data: existingTx } = await adminSupabase
        .from('daily_ledger_transactions')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (existingTx?.ledger_id) {
        const { data: ledgerRow } = await adminSupabase
          .from('daily_ledgers')
          .select('id, branch_id, ledger_date, status')
          .eq('id', existingTx.ledger_id)
          .maybeSingle();
        if (ledgerRow) {
          if (!isGlobal && normalizeBranchId(ledgerRow.branch_id) !== sessionBranch) {
            return NextResponse.json({ error: 'Forbidden. Cross-branch deletion denied.' }, { status: 403 });
          }
          if (String(ledgerRow.status || '').toUpperCase() === 'LOCKED' && session.role !== 'ADMIN') {
            return NextResponse.json({
              error: `Daily Ledger for ${ledgerRow.ledger_date} is LOCKED. Direct modification blocked.`
            }, { status: 403 });
          }
        }
      }

      const { error } = await adminSupabase.from('daily_ledger_transactions').delete().eq('id', id);
      if (error) throw error;

      if (existingTx?.ledger_id) {
        await applyLedgerTotalsDelta({
          ledgerId: existingTx.ledger_id,
          deltaInsurance: category === 'FS' ? -Number(existingTx.insurance_rs || 0) : 0,
          deltaRedeem: category === 'RECEIPT' ? -Number(existingTx.cash_received || 0) : 0,
          allowLockedLedger: session.role === 'ADMIN',
          actorSession: session,
          reason: `Matrix ${category} item delete`,
        });
      }
    } else if (category === 'LOAN' || category === 'REDEEM') {
      const { data: existingStock } = await adminSupabase
        .from('stock_items')
        .select('id, branch_id, bill_no')
        .eq('id', id)
        .maybeSingle();
      if (!existingStock) {
        return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
      }
      if (!isGlobal && normalizeBranchId(existingStock.branch_id) !== sessionBranch) {
        return NextResponse.json({ error: 'Forbidden. Cross-branch deletion denied.' }, { status: 403 });
      }

      await syncPawnAndStockDelete({
        branchId: existingStock.branch_id,
        stockId: id,
        billNo: existingStock.bill_no,
        allowLockedLedger: session.role === 'ADMIN',
        actorSession: session,
        reason: `Matrix ${category} item delete`,
      });
    }

    // Log action to audit_logs
    try {
      await adminSupabase.from('audit_logs').insert([{
        action: 'DELETE_STOCK_MATRIX_ITEM',
        resource: `category:${category}:${id}`,
        branch_id: sessionBranch,
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
    const msg = err?.message || 'Failed to delete item';
    return NextResponse.json({ error: msg }, { status: msg.includes('LOCKED') ? 403 : 500 });
  }
}
