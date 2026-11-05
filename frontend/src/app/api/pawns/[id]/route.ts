import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, formatBranchScopedBillNo, stripBranchPrefix, getBranchSearchTerms, extractNumericBillNo, isSameNumericBill } from '@/lib/branch-mapping';
import { invalidateBranchInventoryCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

export async function GET(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await context.params;

    // 1. Fetch pawn details (support UUID, raw bill_no, or branch-scoped bill_no)
    let query = adminSupabase.from('pawns').select('*');
    if (isUUID(id)) {
      query = query.eq('id', id);
    } else {
      const sessBranch = session?.branchId ? normalizeBranchId(session?.branchId) : null;
      if (sessBranch && sessBranch !== 'HQ') {
        const scoped = formatBranchScopedBillNo(id, sessBranch);
        query = query.or(`bill_no.eq.${id},bill_no.eq.${scoped}`);
      } else {
        const stripped = stripBranchPrefix(id);
        query = query.or(`bill_no.eq.${id},bill_no.ilike.%${stripped}%`);
      }
    }
    const { data: pawn, error: fetchErr } = await query.maybeSingle();

    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    // 2. Branch authorization check: authenticated users can view tickets for inspection, valuation & cross-branch redemptions
    // Modification and deletion remain strictly locked to branch staff or admins in PATCH/DELETE below.

    // 3. Fetch customer / client info
    let client: any = null;
    if (pawn.client_id) {
      const { data: clientRow } = await adminSupabase
        .from('clients')
        .select('*')
        .eq('id', pawn.client_id)
        .maybeSingle();
      client = clientRow;
    }

    // 4. Fetch pawn collateral items
    const { data: items } = await adminSupabase
      .from('pawn_items')
      .select('*')
      .eq('pawn_id', pawn.id);

    // 5. Fetch Archimedes scale evidence photos from rejected_evaluations
    let evaluationEvidence: any = null;
    const cleanBill = (pawn.bill_no || '').trim();
    if (cleanBill) {
      const { data: evalRows } = await adminSupabase
        .from('rejected_evaluations')
        .select('*')
        .eq('status', `BILL:${cleanBill}`)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (evalRows && evalRows.length > 0) {
        evaluationEvidence = evalRows[0];
      }
    }

    // 6. Fetch stock item details from stock_items
    let stockItems: any[] = [];
    if (cleanBill) {
      const { data: sRows } = await adminSupabase
        .from('stock_items')
        .select('*')
        .ilike('bill_no', `%${cleanBill}%`);
      stockItems = sRows || [];
    }

    // 7. Fetch cash & transaction records from transaction table
    let transactions: any[] = [];
    if (pawn.client_id) {
      const { data: txRows } = await adminSupabase
        .from('transaction')
        .select('*')
        .eq('client_id', pawn.client_id)
        .order('timestamp', { ascending: false })
        .limit(10);
      transactions = txRows || [];
    }

    // 8. Fetch daily ledger reconciliation summary for branch on creation date
    let dailyLedger: any = null;
    const pawnDateStr = pawn.created_at ? pawn.created_at.split('T')[0] : '';
    if (pawnDateStr && pawn.branch_id) {
      const searchTerms = getBranchSearchTerms(pawn.branch_id);
      const { data: ledgerRows } = await adminSupabase
        .from('daily_ledgers')
        .select('*')
        .in('branch_id', searchTerms)
        .eq('ledger_date', pawnDateStr)
        .maybeSingle();
      dailyLedger = ledgerRows;
    }

    // 9. Fetch historical audit logs for this bill
    let auditHistory: any[] = [];
    let queryLogs = adminSupabase.from('audit_logs').select('*');
    if (cleanBill) {
      queryLogs = queryLogs.or(`resource.eq.${cleanBill},resource.eq.${pawn.id}`);
    } else {
      queryLogs = queryLogs.eq('resource', pawn.id);
    }
    const { data: aLogs } = await queryLogs.order('created_at', { ascending: false });
    auditHistory = aLogs || [];

    const unresolvedIssues = auditHistory.filter(
      (log: any) => log.action === 'AUDIT_ISSUE_RAISED' && (log.details?.resolved === false || log.details?.status === 'REQUIRES_RECHECK')
    );

    return NextResponse.json({
      success: true,
      pawn,
      client,
      items: items || [],
      evaluationEvidence,
      stockItems,
      transactions,
      dailyLedger,
      auditHistory,
      unresolvedIssues
    });
  } catch (error: any) {
    console.error('Pawn GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const { clientId, description, appraisedValue, disbursedAmount, billNo, weight, weightGrams, weightMg, itemType, items, clientPhone, clientAddress } = body;

    // Fetch existing pawn to check branch authorization
    const { data: existingPawn, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).single();
    if (fetchErr || !existingPawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    if (session && session.role === 'TELLER') {
      if (normalizeBranchId(existingPawn.branch_id) !== normalizeBranchId(session.branchId)) {
        return NextResponse.json({ error: 'Forbidden. Tellers cannot modify pawns belonging to another branch.' }, { status: 403 });
      }
      const isAttemptingFinancialChange = 
        (appraisedValue !== undefined && parseFloat(appraisedValue) !== existingPawn.appraised_value) ||
        (disbursedAmount !== undefined && parseFloat(disbursedAmount) !== existingPawn.disbursed_amount) ||
        (billNo !== undefined && stripBranchPrefix(billNo.trim()) !== stripBranchPrefix(existingPawn.bill_no)) ||
        (weight !== undefined && parseFloat(weight) > 0) ||
        (weightGrams !== undefined && parseFloat(weightGrams) !== existingPawn.weight_grams);

      if (isAttemptingFinancialChange) {
        return NextResponse.json({
          error: 'Direct modifications to pawn loan amounts, gold weights, or bill numbers are prohibited for Tellers. Please submit a Change Request Ticket for Manager approval.'
        }, { status: 403 });
      }
    }

    // Resolve valid Client UUID
    let targetClientId = clientId;
    if (clientId && !isUUID(clientId)) {
      let existingClients = null;
      const { data: idExisting } = await adminSupabase
        .from('clients')
        .select('id, phone, address')
        .eq('id', clientId)
        .limit(1)
        .maybeSingle();
        
      if (idExisting) {
        existingClients = [idExisting];
      } else {
        const { data: snakeExisting } = await adminSupabase
          .from('clients')
          .select('id, phone, address')
          .eq('national_id', clientId)
          .limit(1)
          .maybeSingle();
          
        if (snakeExisting) {
          existingClients = [snakeExisting];
        } else {
          const { data: camelExisting } = await adminSupabase
            .from('clients')
            .select('id, phone, address')
            .eq('nationalId', clientId)
            .limit(1)
            .maybeSingle();
            
          if (camelExisting) {
            existingClients = [camelExisting];
          }
        }
      }

      if (existingClients && existingClients.length > 0) {
        targetClientId = existingClients[0].id;
        
        // Update client info if provided
        if (clientPhone || clientAddress) {
          const updateClient: any = {};
          if (clientPhone && clientPhone !== existingClients[0].phone) updateClient.phone = clientPhone;
          if (clientAddress && clientAddress !== existingClients[0].address) updateClient.address = clientAddress;
          
          if (Object.keys(updateClient).length > 0) {
            await adminSupabase.from('clients').update(updateClient).eq('id', targetClientId);
          }
        }
      }
    }

    // Calculate weight values
    let totWeight = parseFloat(weight) || 0;
    let g = parseFloat(weightGrams);
    let mg = parseFloat(weightMg);
    if (isNaN(g) && isNaN(mg) && totWeight > 0) {
      g = Math.floor(totWeight);
      mg = Math.round((totWeight - g) * 1000);
    }
    if (isNaN(g)) g = 0;
    if (isNaN(mg)) mg = 0;
    if (totWeight === 0 && (g > 0 || mg > 0)) {
      totWeight = g + (mg / 1000);
    }

    const updateObj: any = {};
    if (targetClientId && isUUID(targetClientId)) updateObj.client_id = targetClientId;
    if (description) updateObj.description = description;
    if (appraisedValue !== undefined) updateObj.appraised_value = parseFloat(appraisedValue) || 0;
    if (disbursedAmount !== undefined) updateObj.disbursed_amount = parseFloat(disbursedAmount) || 0;
    if (g > 0 || mg > 0 || totWeight > 0) {
      updateObj.weight_grams = g;
      updateObj.weight_mg = mg;
    }
    if (body.periodMonths !== undefined) {
      updateObj.period_months = parseInt(body.periodMonths, 10) || 3;
    }

    if (billNo && String(billNo).trim() !== '' && String(billNo).trim() !== (existingPawn.bill_no || '').trim()) {
      const isNumericChanged = !isSameNumericBill(existingPawn.bill_no || existingPawn.description, billNo);
      if (isNumericChanged) {
        const numericPart = extractNumericBillNo(billNo);
        if (numericPart) {
          const targetBranch = normalizeBranchId(existingPawn.branch_id || session?.branchId || 'HQ');
          const branchTerms = getBranchSearchTerms(targetBranch);

          const { data: existingPawns } = await adminSupabase
            .from('pawns')
            .select('id, bill_no, description, branch_id')
            .neq('id', id)
            .in('branch_id', branchTerms)
            .ilike('bill_no', `%${numericPart}%`)
            .limit(20);

          const hasDuplicatePawn = (existingPawns || []).some((p: any) => 
            isSameNumericBill(p.bill_no || p.description, billNo)
          );

          if (hasDuplicatePawn) {
            return NextResponse.json({
              error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranch} branch.`
            }, { status: 400 });
          }

          const { data: existingStock } = await adminSupabase
            .from('stock_items')
            .select('id, bill_no, branch_id')
            .in('branch_id', branchTerms)
            .ilike('bill_no', `%${numericPart}%`)
            .limit(20);

          const hasDuplicateStock = (existingStock || []).some((s: any) => 
            !isSameNumericBill(s.bill_no, existingPawn.bill_no || existingPawn.description) &&
            isSameNumericBill(s.bill_no, billNo)
          );

          if (hasDuplicateStock) {
            return NextResponse.json({
              error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranch} branch.`
            }, { status: 400 });
          }
        }
      }
      updateObj.bill_no = formatBranchScopedBillNo(String(billNo).trim(), existingPawn.branch_id);
    }

    const { data, error } = await adminSupabase.from('pawns').update(updateObj).eq('id', id).select().single();

    if (error) throw error;

    const oldBillNo = existingPawn.bill_no || (existingPawn.description ? existingPawn.description.match(/^([A-Za-z0-9]+\s+\d+)/)?.[1]?.trim() : null) || id.substring(0, 8);
    if (oldBillNo) {
      const stockUpdate: any = {};
      if (appraisedValue !== undefined || disbursedAmount !== undefined) {
        stockUpdate.price = parseFloat(disbursedAmount) || parseFloat(appraisedValue) || 0;
      }
      if (totWeight > 0) stockUpdate.weight = totWeight;
      if (itemType) stockUpdate.item_type = itemType;
      const cleanTargetBill = stripBranchPrefix(billNo ? billNo.trim() : oldBillNo);
      if (billNo && billNo.trim() !== oldBillNo) {
        stockUpdate.bill_no = cleanTargetBill;
      }
      
      if (Object.keys(stockUpdate).length > 0) {
        const { data: existingStock } = await adminSupabase
          .from('stock_items')
          .select('id')
          .eq('branch_id', existingPawn.branch_id)
          .or(`bill_no.eq.${oldBillNo},bill_no.eq.${cleanTargetBill}`)
          .maybeSingle();

        if (existingStock) {
          await adminSupabase.from('stock_items').update(stockUpdate).eq('id', existingStock.id);
        } else {
          // If pawn was missing in stock_items, auto-create it now
          await adminSupabase.from('stock_items').insert([{
            id: crypto.randomUUID(),
            bill_no: cleanTargetBill,
            branch_id: existingPawn.branch_id,
            item_type: stockUpdate.item_type || 'CH',
            weight: stockUpdate.weight || totWeight || 0,
            price: stockUpdate.price || parseFloat(disbursedAmount) || parseFloat(appraisedValue) || 0,
            status: 'Active',
            date: new Date().toISOString().split('T')[0]
          }]);
        }
        try {
          await invalidateBranchInventoryCache(existingPawn.branch_id);
        } catch (cErr) {
          console.warn('[Cache Invalidation Warning]:', cErr);
        }
      }
    }

    // Update or Insert pawn_items if weight or items are provided
    const { data: existingItems } = await adminSupabase.from('pawn_items').select('*').eq('pawn_id', id);
    if (existingItems && existingItems.length > 0) {
      await adminSupabase.from('pawn_items').update({
        weight_grams: g,
        weight_mg: mg,
        appraised_value: parseFloat(appraisedValue) || 0,
        description: description || existingItems[0].description
      }).eq('id', existingItems[0].id);
    } else {
      await adminSupabase.from('pawn_items').insert([{
        pawn_id: id,
        item_type: itemType || 'CH',
        description: description || 'Collateral Article',
        weight_grams: g,
        weight_mg: mg,
        appraised_value: parseFloat(appraisedValue) || 0
      }]);
    }

    return NextResponse.json({
       ...data,
       weight: totWeight
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await context.params;

    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct pawn deletion is strictly prohibited for Tellers. Please submit a Change Request Ticket for Manager/Admin review.' 
      }, { status: 403 });
    }

    // Fetch pawn details first to verify branch authorization and description / bill_no
    const { data: pawn, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).single();
    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    const { error } = await adminSupabase.from('pawns').delete().eq('id', id);
    if (error) throw error;

    // Also delete from stock_items using stored bill_no or regex fallback
    const targetBillNo = pawn.bill_no || (pawn.description ? pawn.description.match(/^([A-Za-z0-9]+\s+\d+)/)?.[1]?.trim() : null);
    if (targetBillNo) {
      await adminSupabase.from('stock_items').delete().eq('bill_no', targetBillNo);
      try {
        await invalidateBranchInventoryCache(pawn.branch_id);
      } catch (cErr) {
        console.warn('[Cache Invalidation Warning]:', cErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
