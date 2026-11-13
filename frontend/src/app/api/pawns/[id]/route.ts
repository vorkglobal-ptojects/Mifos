import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, formatBranchScopedBillNo, stripBranchPrefix, getBranchSearchTerms, extractNumericBillNo, isSameNumericBill } from '@/lib/branch-mapping';
import {
  syncClientAcrossModules,
  syncPawnAndStockUpdate,
  syncPawnAndStockDelete,
} from '@/lib/cross-sync';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

export async function GET(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
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

    // 9. Fetch historical audit logs scoped to this pawn or its branch
    let auditHistory: any[] = [];
    const pawnBranchCode = normalizeBranchId(pawn.branch_id || '');
    let queryLogs = adminSupabase.from('audit_logs').select('*');
    if (cleanBill) {
      queryLogs = queryLogs.or(`resource.eq."${cleanBill}",resource.eq."${pawn.id}"`);
    } else {
      queryLogs = queryLogs.eq('resource', pawn.id);
    }
    const { data: aLogs } = await queryLogs.order('created_at', { ascending: false });
    auditHistory = (aLogs || []).filter((log: any) => {
      const logPawnId = log.details?.pawn_id;
      if (logPawnId) return logPawnId === pawn.id;
      const logBranch = normalizeBranchId(log.branch_id || log.details?.branch_id || '');
      return !pawnBranchCode || !logBranch || logBranch === pawnBranchCode;
    });

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
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot directly edit pawn records.' }, { status: 403 });
    }
    const { id } = await context.params;
    const body = await request.json();
    const { clientId, clientName, description, appraisedValue, disbursedAmount, billNo, weight, weightGrams, weightMg, itemType, periodMonths, clientPhone, clientAddress } = body;

    // Fetch existing pawn to check branch authorization
    const { data: existingPawn, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).single();
    if (fetchErr || !existingPawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    const sessionBranch = session.branchId ? normalizeBranchId(session.branchId) : '';
    const isGlobalRole = session.role === 'ADMIN' || sessionBranch === 'HQ';
    const pawnBranch = normalizeBranchId(existingPawn.branch_id || 'HQ');
    if (!isGlobalRole && sessionBranch && pawnBranch !== sessionBranch) {
      return NextResponse.json({ error: 'Forbidden. Cannot modify pawns belonging to another branch.' }, { status: 403 });
    }

    if (session && session.role === 'TELLER') {
      const existingTotWeight = (Number(existingPawn.weight_grams) || 0) + ((Number(existingPawn.weight_mg) || 0) / 1000);
      const isAttemptingFinancialChange = 
        (appraisedValue !== undefined && parseFloat(appraisedValue) !== existingPawn.appraised_value) ||
        (disbursedAmount !== undefined && parseFloat(disbursedAmount) !== existingPawn.disbursed_amount) ||
        (billNo !== undefined && stripBranchPrefix(billNo.trim()) !== stripBranchPrefix(existingPawn.bill_no)) ||
        (weight !== undefined && Math.abs(parseFloat(weight) - existingTotWeight) > 0.0005) ||
        (weightGrams !== undefined && parseFloat(weightGrams) !== existingPawn.weight_grams) ||
        (periodMonths !== undefined && parseInt(periodMonths, 10) !== (existingPawn.period_months || 3));

      if (isAttemptingFinancialChange) {
        return NextResponse.json({
          error: 'Direct modifications to pawn loan amounts, gold weights, loan period, or bill numbers are prohibited for Tellers. Please submit a Change Request Ticket for Manager approval.'
        }, { status: 403 });
      }
    }

    // Resolve valid Client UUID (scoped strictly to pawnBranch) & sync client updates if provided
    let targetClientId = clientId || existingPawn.client_id;
    let resolvedClientRow: any = null;
    if (targetClientId && isUUID(targetClientId)) {
      const { data: cById } = await adminSupabase
        .from('clients')
        .select('*')
        .eq('id', targetClientId)
        .maybeSingle();
      resolvedClientRow = cById;
    } else if (targetClientId) {
      const { data: cByNic } = await adminSupabase
        .from('clients')
        .select('*')
        .in('branch_id', getBranchSearchTerms(pawnBranch))
        .ilike('national_id', String(targetClientId).trim())
        .limit(1)
        .maybeSingle();
      if (cByNic) {
        resolvedClientRow = cByNic;
        targetClientId = cByNic.id;
      }
    }

    if (resolvedClientRow && (clientPhone || clientAddress || clientName)) {
      const updateClient: any = {};
      if (clientName && String(clientName).trim() && String(clientName).trim() !== resolvedClientRow.first_name) {
        updateClient.first_name = String(clientName).trim();
      }
      if (clientPhone && String(clientPhone).trim() !== (resolvedClientRow.phone || '')) {
        updateClient.phone = String(clientPhone).trim();
      }
      if (clientAddress && String(clientAddress).trim() !== (resolvedClientRow.address || '')) {
        updateClient.address = String(clientAddress).trim();
      }
      if (Object.keys(updateClient).length > 0) {
        await adminSupabase.from('clients').update(updateClient).eq('id', resolvedClientRow.id);
        await syncClientAcrossModules({
          clientId: resolvedClientRow.id,
          branchId: resolvedClientRow.branch_id || pawnBranch,
          oldNationalId: resolvedClientRow.national_id,
          newNationalId: resolvedClientRow.national_id,
          firstName: updateClient.first_name || resolvedClientRow.first_name,
          lastName: resolvedClientRow.last_name,
          phone: updateClient.phone || resolvedClientRow.phone,
          address: updateClient.address || resolvedClientRow.address,
          oldPhone: resolvedClientRow.phone,
          oldName: resolvedClientRow.first_name,
        });
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

    if (targetClientId && isUUID(targetClientId) && targetClientId !== existingPawn.client_id) {
      await adminSupabase.from('pawns').update({ client_id: targetClientId }).eq('id', id);
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
            .limit(100);

          const hasDuplicatePawn = (existingPawns || []).some((p: any) => 
            normalizeBranchId(p.branch_id) === targetBranch &&
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
            .limit(100);

          const hasDuplicateStock = (existingStock || []).some((s: any) => 
            normalizeBranchId(s.branch_id) === targetBranch &&
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
    }

    const syncUpdates: Record<string, any> = {};
    if (billNo && String(billNo).trim()) syncUpdates.bill_no = String(billNo).trim();
    if (description) syncUpdates.description = description;
    if (itemType) syncUpdates.item_type = itemType;
    if (appraisedValue !== undefined) syncUpdates.appraised_value = parseFloat(appraisedValue) || 0;
    if (disbursedAmount !== undefined) syncUpdates.disbursed_amount = parseFloat(disbursedAmount) || 0;
    if (g > 0 || mg > 0 || totWeight > 0) {
      syncUpdates.weight_grams = totWeight > 0 ? totWeight : g + mg / 1000;
      syncUpdates.weight_mg = mg > 0 ? mg : Math.round(totWeight * 1000);
    }
    if (periodMonths !== undefined) syncUpdates.period_months = parseInt(periodMonths, 10) || 3;

    const { pawn: updatedPawn } = await syncPawnAndStockUpdate({
      source: 'PAWN',
      pawnId: id,
      branchId: pawnBranch,
      updates: syncUpdates,
      allowLockedLedger: session.role === 'ADMIN',
      actorSession: session,
      reason: 'Direct pawn PATCH update',
    });

    return NextResponse.json({
      ...(updatedPawn || existingPawn),
      weight: totWeight
    });
  } catch (error: any) {
    const msg = error?.message || 'Failed to update pawn ticket';
    const status = msg.includes('LOCKED') ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    const { id } = await context.params;

    if (session.role === 'TELLER' || session.role === 'AUDITOR') {
      return NextResponse.json({ 
        error: 'Direct pawn deletion is strictly prohibited for this role. Please submit a Change Request Ticket for Manager/Admin review.' 
      }, { status: 403 });
    }

    const { data: pawn, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).single();
    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    const sessionBranch = session.branchId ? normalizeBranchId(session.branchId) : '';
    const isGlobalRole = session.role === 'ADMIN' || sessionBranch === 'HQ';
    const pawnBranch = normalizeBranchId(pawn.branch_id || 'HQ');
    if (!isGlobalRole && sessionBranch && pawnBranch !== sessionBranch) {
      return NextResponse.json({ error: 'Forbidden. Cannot delete pawn belonging to another branch.' }, { status: 403 });
    }

    const targetBillNo = pawn.bill_no || (pawn.description ? pawn.description.match(/^([A-Za-z0-9]+\s+\d+)/)?.[1]?.trim() : '');
    await syncPawnAndStockDelete({
      branchId: pawnBranch,
      pawnId: id,
      billNo: targetBillNo,
      allowLockedLedger: session.role === 'ADMIN',
      actorSession: session,
      reason: 'Direct pawn ticket deletion',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const msg = error?.message || 'Failed to delete pawn ticket';
    const status = msg.includes('LOCKED') ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
