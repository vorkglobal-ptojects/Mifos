import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { getBranchSearchTerms, normalizeBranchId, stripBranchPrefix, extractNumericBillNo, isSameNumericBill } from '@/lib/branch-mapping';
import { recordAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      const cookieHeader = request.headers.get('cookie') || '';
      const hasAuthCookie = cookieHeader.includes('sb-') || cookieHeader.includes('auth_');
      const hasBranchHeader = Boolean(request.headers.get('x-branch-id') || request.headers.get('authorization'));
      if (!hasAuthCookie && !hasBranchHeader) {
        return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
      }
    }


    const { searchParams } = new URL(request.url);
    const branchParam = searchParams.get('branch');
    const searchParam = searchParams.get('search');
    const statusParam = searchParams.get('status');

    const headerBranch = request.headers.get('x-branch-id') || request.headers.get('X-Branch-Id');
    const activeBranch = branchParam || headerBranch || session?.branchId || 'ALL';

    // Paginated fetch to bypass PostgREST's 1000-row default limit
    let allItems: any[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = adminSupabase
        .from('stock_items')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      // Branch filter
      if (activeBranch !== 'ALL' && activeBranch.trim() !== '') {
        const branchTerms = getBranchSearchTerms(activeBranch);
        query = query.in('branch_id', branchTerms);
      }

      // Status filter (Active / Withdrawn)
      if (statusParam && statusParam !== 'ALL') {
        query = query.eq('status', statusParam);
      }

      // Bill / Item search filter
      if (searchParam && searchParam.trim() !== '') {
        const cleanSearch = searchParam.trim();
        query = query.or(`bill_no.ilike.%${cleanSearch}%,item_type.ilike.%${cleanSearch}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allItems = allItems.concat(data);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    return NextResponse.json({
      success: true,
      items: allItems,
      count: allItems.length
    });
  } catch (err: any) {
    console.error('Stock GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch stock items' }, { status: 500 });
  }
}

function normalizeWeightToGrams(rawWeight: any): number {
  const w = parseFloat(rawWeight) || 0;
  if (w <= 0) return 0;
  // If weight >= 100, user entered Milligrams (e.g. 5170mg -> 5.17g)
  if (w >= 100) return parseFloat((w / 1000).toFixed(4));
  // If weight < 100, it is already in Grams (e.g. 5.17g)
  return parseFloat(w.toFixed(4));
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      const cookieHeader = request.headers.get('cookie') || '';
      const hasAuthCookie = cookieHeader.includes('sb-') || cookieHeader.includes('auth_');
      const hasBranchHeader = Boolean(request.headers.get('x-branch-id') || request.headers.get('authorization'));
      if (!hasAuthCookie && !hasBranchHeader) {
        return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { bill_no, price, weight, date, item_type, branch_id, status } = body;

    if (!bill_no) {
      return NextResponse.json({ error: 'Bill number is required' }, { status: 400 });
    }

    const normBranch = normalizeBranchId(branch_id || request.headers.get('x-branch-id') || session?.branchId || 'HQ');
    const branchTerms = getBranchSearchTerms(normBranch);

    const numericPart = extractNumericBillNo(bill_no);
    if (numericPart) {
      const { data: existingStock } = await adminSupabase
        .from('stock_items')
        .select('id, bill_no, branch_id')
        .in('branch_id', branchTerms)
        .ilike('bill_no', `%${numericPart}%`)
        .limit(20);

      const hasDuplicateStock = (existingStock || []).some((s: any) => 
        isSameNumericBill(s.bill_no, bill_no)
      );

      if (hasDuplicateStock) {
        return NextResponse.json({
          error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${normBranch} branch.`
        }, { status: 400 });
      }

      const { data: existingPawns } = await adminSupabase
        .from('pawns')
        .select('id, bill_no, description, branch_id')
        .in('branch_id', branchTerms)
        .ilike('bill_no', `%${numericPart}%`)
        .limit(20);

      const hasDuplicatePawn = (existingPawns || []).some((p: any) => 
        isSameNumericBill(p.bill_no || p.description, bill_no)
      );

      if (hasDuplicatePawn) {
        return NextResponse.json({
          error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${normBranch} branch.`
        }, { status: 400 });
      }
    }

    const payload: any = {
      bill_no: stripBranchPrefix(String(bill_no)).trim(),
      price: parseFloat(price) || 0,
      weight: normalizeWeightToGrams(weight),
      date: date || new Date().toISOString().split('T')[0],
      item_type: item_type || 'Gold Item',
      status: status || 'Active',
      branch_id: normBranch,
      created_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
      .from('stock_items')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('[Stock POST Error]:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Stock item added successfully',
      item: data
    }, { status: 201 });
  } catch (err: any) {
    console.error('Stock POST exception:', err);
    return NextResponse.json({ error: err.message || 'Failed to add stock item' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      const cookieHeader = request.headers.get('cookie') || '';
      const hasAuthCookie = cookieHeader.includes('sb-') || cookieHeader.includes('auth_');
      const hasBranchHeader = Boolean(request.headers.get('x-branch-id') || request.headers.get('authorization'));
      if (!hasAuthCookie && !hasBranchHeader) {
        return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { 
      id, 
      bill_no, 
      price, 
      weight, 
      date, 
      item_type, 
      branch_id, 
      status,
      withdrawal_date,
      withdrawal_reason,
      withdrawal_notes
    } = body;

    // Maker-Checker: Tellers cannot directly modify stock (must use change_requests)
    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct stock modification is strictly prohibited for Tellers. Please submit a Change Request Ticket for Manager/Admin approval.' 
      }, { status: 403 });
    }

    if (!id) {
      return NextResponse.json({ error: 'Stock item ID is required for update' }, { status: 400 });
    }

    const { data: currentStockItem, error: fetchErr } = await adminSupabase
      .from('stock_items')
      .select('id, bill_no, branch_id, price, weight')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !currentStockItem) {
      return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
    }

    if (bill_no !== undefined && bill_no) {
      const isNumericChanged = !isSameNumericBill(currentStockItem.bill_no, bill_no);
      if (isNumericChanged) {
        const numericPart = extractNumericBillNo(bill_no);
        if (numericPart) {
          const targetBranch = normalizeBranchId(currentStockItem.branch_id || branch_id || session?.branchId || 'HQ');
          const branchTerms = getBranchSearchTerms(targetBranch);

          const { data: existingStock } = await adminSupabase
            .from('stock_items')
            .select('id, bill_no, branch_id')
            .neq('id', id)
            .in('branch_id', branchTerms)
            .ilike('bill_no', `%${numericPart}%`)
            .limit(20);

          const hasDuplicateStock = (existingStock || []).some((s: any) => 
            isSameNumericBill(s.bill_no, bill_no)
          );

          if (hasDuplicateStock) {
            return NextResponse.json({
              error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranch} branch.`
            }, { status: 400 });
          }

          const { data: existingPawns } = await adminSupabase
            .from('pawns')
            .select('id, bill_no, description, branch_id')
            .in('branch_id', branchTerms)
            .ilike('bill_no', `%${numericPart}%`)
            .limit(20);

          const hasDuplicatePawn = (existingPawns || []).some((p: any) => 
            !isSameNumericBill(p.bill_no || p.description, currentStockItem.bill_no) &&
            isSameNumericBill(p.bill_no || p.description, bill_no)
          );

          if (hasDuplicatePawn) {
            return NextResponse.json({
              error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranch} branch.`
            }, { status: 400 });
          }
        }
      }
    }

    const updatePayload: any = {};
    if (bill_no !== undefined) updatePayload.bill_no = bill_no ? stripBranchPrefix(String(bill_no)).trim() : bill_no;
    if (price !== undefined) updatePayload.price = parseFloat(price) || 0;
    if (weight !== undefined) updatePayload.weight = normalizeWeightToGrams(weight);
    if (date !== undefined) updatePayload.date = date;
    if (item_type !== undefined) updatePayload.item_type = item_type;
    if (branch_id !== undefined) updatePayload.branch_id = normalizeBranchId(branch_id);
    if (status !== undefined) updatePayload.status = status;
    if (withdrawal_date !== undefined) updatePayload.withdrawal_date = withdrawal_date;
    if (withdrawal_reason !== undefined) updatePayload.withdrawal_reason = withdrawal_reason;
    if (withdrawal_notes !== undefined) updatePayload.withdrawal_notes = withdrawal_notes;

    const { data, error } = await adminSupabase
      .from('stock_items')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Stock PUT Error]:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Sync Pawn status if stock item is Withdrawn or Restored
    try {
      const targetBill = data.bill_no || currentStockItem?.bill_no;
      const targetBranch = data.branch_id || currentStockItem?.branch_id;
      if (targetBill && targetBranch) {
        const branchTerms = getBranchSearchTerms(targetBranch);
        const numericPart = extractNumericBillNo(targetBill);
        
        if (status === 'Withdrawn') {
          // If reason is Pawn Redeemed (Closed), mark pawn as REDEEMED
          const { data: matchedPawns } = await adminSupabase
            .from('pawns')
            .select('id, bill_no, status')
            .in('branch_id', branchTerms)
            .ilike('bill_no', `%${numericPart || targetBill}%`)
            .eq('status', 'ACTIVE')
            .limit(5);

          const exactPawn = (matchedPawns || []).find((p: any) => isSameNumericBill(p.bill_no, targetBill));
          if (exactPawn) {
            await adminSupabase.from('pawns').update({
              status: 'REDEEMED',
              redeemed_at: withdrawal_date ? new Date(withdrawal_date).toISOString() : new Date().toISOString(),
              redeemed_by: (session as any)?.profile?.name || session?.user?.email || 'Vault Cashier',
              redeem_amount: currentStockItem?.price || data.price || 0
            }).eq('id', exactPawn.id);
          }
        } else if (status === 'Active') {
          // If restored to Active, restore pawn if it was REDEEMED
          const { data: matchedPawns } = await adminSupabase
            .from('pawns')
            .select('id, bill_no, status')
            .in('branch_id', branchTerms)
            .ilike('bill_no', `%${numericPart || targetBill}%`)
            .eq('status', 'REDEEMED')
            .limit(5);

          const exactPawn = (matchedPawns || []).find((p: any) => isSameNumericBill(p.bill_no, targetBill));
          if (exactPawn) {
            await adminSupabase.from('pawns').update({
              status: 'ACTIVE',
              redeemed_at: null,
              redeemed_by: null,
              redeem_amount: null
            }).eq('id', exactPawn.id);
          }
        }
      }
    } catch (syncErr) {
      console.warn('[Pawn status sync warning during stock update]:', syncErr);
    }

    // Record Security Audit Log for Stock operations
    try {
      const targetBill = data.bill_no || currentStockItem?.bill_no || id;
      const targetBranch = data.branch_id || currentStockItem?.branch_id || session?.branchId || 'HQ';

      if (status === 'Withdrawn') {
        await recordAuditLog(session, {
          action: 'WITHDRAW_STOCK',
          resource: `stock_items:${targetBill}`,
          branchId: targetBranch,
          role: session?.role || 'TELLER',
          details: {
            stock_id: id,
            bill_no: targetBill,
            branch_id: targetBranch,
            reason: withdrawal_reason || data.withdrawal_reason || 'Stock Withdrawal',
            date: withdrawal_date || data.withdrawal_date,
            notes: withdrawal_notes || data.withdrawal_notes || '',
            price: data.price || currentStockItem?.price || 0,
            weight: data.weight || currentStockItem?.weight || 0,
            status: 'SUCCESS'
          },
          request
        });
      } else if (status === 'Active' && currentStockItem) {
        await recordAuditLog(session, {
          action: 'STOCK_RESTORE_TO_SAFE',
          resource: `stock_items:${targetBill}`,
          branchId: targetBranch,
          role: session?.role || 'TELLER',
          details: {
            stock_id: id,
            bill_no: targetBill,
            branch_id: targetBranch,
            restored_to: 'Active',
            price: data.price || currentStockItem?.price || 0,
            status: 'SUCCESS'
          },
          request
        });
      }
    } catch (auditErr) {
      console.warn('[Stock audit log warning]:', auditErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Stock item updated successfully',
      item: data
    });
  } catch (err: any) {
    console.error('Stock PUT exception:', err);
    return NextResponse.json({ error: err.message || 'Failed to update stock item' }, { status: 500 });
  }
}
