import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase, validateFinancialActionAuth } from '@/lib/auth-server';
import { calculateDenominationTotal } from '@/lib/cash-management';
import { recordAuditLog } from '@/lib/audit-logger';
import { getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';
import { getSriLankaDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, tillId, sessionId, openingCash = 0, denominations, notes } = body;

    // -------------------------------------------------------------
    // ACTION 1: OPEN TILL SESSION
    // -------------------------------------------------------------
    if (action === 'OPEN') {
      if (!tillId) {
        return NextResponse.json({ error: 'tillId is required to open a session.' }, { status: 400 });
      }

      // Check till details
      const { data: till, error: tillErr } = await adminSupabase
        .from('cash_tills')
        .select('*')
        .eq('id', tillId)
        .single();

      if (tillErr || !till) {
        return NextResponse.json({ error: 'Cash till not found.' }, { status: 404 });
      }

      // Enforce branch security: user must be assigned to this branch unless Admin
      const authCheck = validateFinancialActionAuth(session, till.branch_id, ['ADMIN', 'MANAGER', 'TELLER']);
      if (!authCheck.authorized) {
        return NextResponse.json({ error: authCheck.error }, { status: 403 });
      }

      // Check for already open session on this till
      const { data: existingOpen } = await adminSupabase
        .from('till_sessions')
        .select('id')
        .eq('till_id', tillId)
        .eq('status', 'OPEN')
        .maybeSingle();

      if (existingOpen) {
        return NextResponse.json({ error: 'This till already has an active OPEN session.' }, { status: 409 });
      }

      const parsedOpening = Number(openingCash ?? 0);
      if (!Number.isFinite(parsedOpening) || parsedOpening < 0) {
        return NextResponse.json({ error: 'Opening cash must be a valid non-negative number.' }, { status: 400 });
      }

      const { data: newSession, error: createErr } = await adminSupabase
        .from('till_sessions')
        .insert([{
          till_id: tillId,
          user_id: session.user.id,
          branch_id: till.branch_id,
          session_date: getSriLankaDate(),
          opened_at: new Date().toISOString(),
          opening_cash: parsedOpening,
          system_expected_cash: parsedOpening,
          status: 'OPEN',
          notes: notes || null
        }])
        .select()
        .single();

      if (createErr) {
        return NextResponse.json({ error: createErr.message }, { status: 500 });
      }

      await recordAuditLog(session, {
        action: 'TILL_SESSION_OPENED',
        resource: `Till Session #${newSession.id}`,
        branchId: till.branch_id,
        details: { tillId, openingCash: parsedOpening }
      });

      return NextResponse.json({ success: true, session: newSession }, { status: 201 });
    }

    // -------------------------------------------------------------
    // ACTION 2: CLOSE TILL SESSION (WITH DENOMINATIONS)
    // -------------------------------------------------------------
    if (action === 'CLOSE') {
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId is required to close a session.' }, { status: 400 });
      }

      const { data: currentSession, error: sessionErr } = await adminSupabase
        .from('till_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionErr || !currentSession) {
        return NextResponse.json({ error: 'Till session not found.' }, { status: 404 });
      }

      if (currentSession.status !== 'OPEN') {
        return NextResponse.json({ error: 'Till session is already closed.' }, { status: 400 });
      }

      const authCheck = validateFinancialActionAuth(session, currentSession.branch_id, ['ADMIN', 'MANAGER', 'TELLER']);
      if (!authCheck.authorized) {
        return NextResponse.json({ error: authCheck.error }, { status: 403 });
      }

      if (!denominations) {
        return NextResponse.json({ error: 'Physical currency denomination counts are required to close till session.' }, { status: 400 });
      }

      // Calculate server-side verified denomination total
      const denomCalc = calculateDenominationTotal(denominations);
      if (!denomCalc.isValid) {
        return NextResponse.json({ error: denomCalc.error || 'Invalid denomination breakdown.' }, { status: 400 });
      }

      const actualCash = denomCalc.total;

      // Compute server-side expected cash from opening float + shift transactions & cash transfers
      const shiftStartIso = currentSession.opened_at;
      const branchTerms = getBranchSearchTerms(currentSession.branch_id);
      const normSessionBranch = normalizeBranchId(currentSession.branch_id);
      let serverExpectedCash = Number(currentSession.opening_cash || 0);

      const { data: shiftTxs } = await adminSupabase
        .from('transaction')
        .select('type, amount')
        .in('branch_id', branchTerms)
        .gte('timestamp', shiftStartIso);

      for (const tx of shiftTxs || []) {
        const amt = Number(tx.amount || 0);
        const t = String(tx.type || '').toUpperCase();
        if (t === 'PAWN_REDEEM' || t === 'CASH_IN' || t === 'INTEREST') {
          serverExpectedCash += amt;
        } else if (t === 'PAWN_DISBURSE' || t === 'CASH_OUT' || t === 'EXPENSE') {
          serverExpectedCash -= amt;
        }
      }

      const { data: inwardTransfers } = await adminSupabase
        .from('cash_transfers')
        .select('amount')
        .eq('destination_branch_id', normSessionBranch)
        .eq('status', 'ACCEPTED')
        .gte('updated_at', shiftStartIso);

      for (const trf of inwardTransfers || []) {
        serverExpectedCash += Number(trf.amount || 0);
      }

      const { data: outwardTransfers } = await adminSupabase
        .from('cash_transfers')
        .select('amount, source_bank_id')
        .eq('source_branch_id', normSessionBranch)
        .in('status', ['IN_TRANSIT', 'ACCEPTED'])
        .gte('updated_at', shiftStartIso);

      for (const trf of outwardTransfers || []) {
        if (!trf.source_bank_id) {
          serverExpectedCash -= Number(trf.amount || 0);
        }
      }

      const expectedCash = Number(serverExpectedCash.toFixed(2));
      const variance = Number((actualCash - expectedCash).toFixed(2));
      const isMismatch = Math.abs(variance) > 0.01;
      const finalStatus = isMismatch ? 'FLAGGED' : 'CLOSED';

      // 1. Update Till Session (atomic guard against double-close)
      const { data: updatedSession, error: updateErr } = await adminSupabase
        .from('till_sessions')
        .update({
          closed_at: new Date().toISOString(),
          actual_counted_cash: actualCash,
          system_expected_cash: expectedCash,
          variance_amount: variance,
          status: finalStatus,
          notes: notes || currentSession.notes || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('status', 'OPEN')
        .select()
        .maybeSingle();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
      if (!updatedSession) {
        return NextResponse.json({ error: 'Till session was already closed concurrently.' }, { status: 409 });
      }

      // 2. Insert Denomination Record
      const { error: denomInsErr } = await adminSupabase.from('till_denominations').insert([{
        session_id: sessionId,
        count_type: 'CLOSING',
        notes_5000: denomCalc.breakdown.notes_5000,
        notes_2000: denomCalc.breakdown.notes_2000,
        notes_1000: denomCalc.breakdown.notes_1000,
        notes_500:  denomCalc.breakdown.notes_500,
        notes_100:  denomCalc.breakdown.notes_100,
        notes_50:   denomCalc.breakdown.notes_50,
        notes_20:   denomCalc.breakdown.notes_20,
        notes_10:   denomCalc.breakdown.notes_10,
        coins_total: denomCalc.breakdown.coins_total,
        total_amount: actualCash,
        counted_by_user_id: session.user.id,
        counted_at: new Date().toISOString()
      }]);
      if (denomInsErr) {
        return NextResponse.json({ error: 'Failed to record till closing denominations: ' + denomInsErr.message }, { status: 500 });
      }

      await recordAuditLog(session, {
        action: 'TILL_SESSION_CLOSED',
        resource: `Till Session #${sessionId}`,
        branchId: currentSession.branch_id,
        details: {
          actualCash,
          expectedCash,
          variance,
          status: finalStatus
        }
      });

      return NextResponse.json({
        success: true,
        session: updatedSession,
        variance,
        status: finalStatus
      });
    }

    return NextResponse.json({ error: "Invalid action. Supported actions: 'OPEN', 'CLOSE'" }, { status: 400 });
  } catch (err: any) {
    console.error('Till session API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
