import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase, validateFinancialActionAuth } from '@/lib/auth-server';
import { calculateDenominationTotal, generateCashReference } from '@/lib/cash-management';
import { recordAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      transferId,
      dispatchedAmount,
      denominations,
      transportCarrierType = 'INTERNAL_STAFF',
      carrierPersonName,
      carrierPersonNic,
      carrierVehicleNo,
      securityBagSealNo,
      handoverNotes
    } = body;

    if (!transferId) {
      return NextResponse.json({ error: 'transferId is required.' }, { status: 400 });
    }

    if (!carrierPersonName?.trim() || !carrierPersonNic?.trim() || !securityBagSealNo?.trim()) {
      return NextResponse.json({
        error: 'Courier / Transport Person Name, NIC, and Security Bag Seal Number are mandatory for physical cash dispatch.'
      }, { status: 400 });
    }

    // 1. Fetch Transfer Record
    const { data: transfer, error: fetchErr } = await adminSupabase
      .from('cash_transfers')
      .select('*')
      .eq('id', transferId)
      .single();

    if (fetchErr || !transfer) {
      return NextResponse.json({ error: 'Cash transfer not found.' }, { status: 404 });
    }

    if (transfer.status !== 'ASSIGNED') {
      return NextResponse.json({
        error: `Cannot dispatch transfer with current status '${transfer.status}'. Only 'ASSIGNED' transfers can be dispatched.`
      }, { status: 400 });
    }

    // 2. Strict Source Branch Security: Only staff authorized at the source branch can dispatch cash
    const authCheck = validateFinancialActionAuth(session, transfer.source_branch_id, ['ADMIN', 'MANAGER', 'TELLER']);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 403 });
    }

    const amount = Number(dispatchedAmount || transfer.amount);
    if (amount <= 0) {
      return NextResponse.json({ error: 'Dispatched amount must be greater than 0.' }, { status: 400 });
    }

    // 3. Denomination Verification on the Server
    if (!denominations) {
      return NextResponse.json({ error: 'Physical denomination breakdown is required for cash dispatch.' }, { status: 400 });
    }

    const denomCalc = calculateDenominationTotal(denominations);
    if (!denomCalc.isValid) {
      return NextResponse.json({ error: denomCalc.error || 'Invalid denomination breakdown.' }, { status: 400 });
    }

    if (Math.abs(denomCalc.total - amount) > 0.01) {
      return NextResponse.json({
        error: `Denomination breakdown total (Rs. ${denomCalc.total.toLocaleString()}) does not match the dispatched amount (Rs. ${amount.toLocaleString()}).`
      }, { status: 400 });
    }

    const dispatchRef = generateCashReference('DSP');
    const dispatchTime = new Date().toISOString();

    // 4. Create Cash Dispatch Record (Record 2: Handover)
    const { data: dispatchRecord, error: dispatchErr } = await adminSupabase
      .from('cash_dispatches')
      .insert([{
        dispatch_ref: dispatchRef,
        transfer_id: transfer.id,
        dispatched_by_user_id: session.user.id,
        dispatched_by_email: session.user.email || 'cashier@mifos.lk',
        dispatched_amount: amount,
        transport_carrier_type: transportCarrierType,
        carrier_person_name: carrierPersonName.trim(),
        carrier_person_nic: carrierPersonNic.trim().toUpperCase(),
        carrier_vehicle_no: carrierVehicleNo?.trim() || null,
        security_bag_seal_no: securityBagSealNo.trim().toUpperCase(),
        handover_notes: handoverNotes?.trim() || null,
        dispatched_at: dispatchTime,
        created_at: dispatchTime
      }])
      .select()
      .single();

    if (dispatchErr) {
      return NextResponse.json({ error: 'Failed to record cash dispatch: ' + dispatchErr.message }, { status: 500 });
    }

    // 5. Store Denomination Breakdown for Dispatch
    const { error: denomErr } = await adminSupabase.from('cash_transfer_denominations').insert([{
      transfer_id: transfer.id,
      stage: 'DISPATCH',
      notes_5000: denomCalc.breakdown.notes_5000,
      notes_2000: denomCalc.breakdown.notes_2000,
      notes_1000: denomCalc.breakdown.notes_1000,
      notes_500:  denomCalc.breakdown.notes_500,
      notes_100:  denomCalc.breakdown.notes_100,
      notes_50:   denomCalc.breakdown.notes_50,
      notes_20:   denomCalc.breakdown.notes_20,
      notes_10:   denomCalc.breakdown.notes_10,
      coins_total: denomCalc.breakdown.coins_total,
      total_amount: amount,
      recorded_by_user_id: session.user.id,
      created_at: dispatchTime
    }]);
    if (denomErr) {
      await adminSupabase.from('cash_dispatches').delete().eq('id', dispatchRecord.id);
      return NextResponse.json({ error: 'Failed to store dispatch denominations: ' + denomErr.message }, { status: 500 });
    }

    // 6. Update Transfer Status to IN_TRANSIT (atomic guard against duplicate dispatches)
    const { data: updatedTransferRows, error: trfUpdErr } = await adminSupabase
      .from('cash_transfers')
      .update({
        status: 'IN_TRANSIT',
        updated_at: dispatchTime
      })
      .eq('id', transfer.id)
      .eq('status', 'ASSIGNED')
      .select('id');

    if (trfUpdErr || !updatedTransferRows || updatedTransferRows.length === 0) {
      await adminSupabase.from('cash_transfer_denominations').delete().eq('transfer_id', transfer.id).eq('stage', 'DISPATCH');
      await adminSupabase.from('cash_dispatches').delete().eq('id', dispatchRecord.id);
      return NextResponse.json({
        error: trfUpdErr?.message || 'Cash transfer was already dispatched concurrently.'
      }, { status: trfUpdErr ? 500 : 409 });
    }

    // If linked to cash request, update request status too
    if (transfer.request_id) {
      const { error: reqUpdErr } = await adminSupabase
        .from('cash_requests')
        .update({ status: 'IN_TRANSIT', updated_at: dispatchTime })
        .eq('id', transfer.request_id);
      if (reqUpdErr) {
        console.warn('Warning syncing linked cash_request to IN_TRANSIT:', reqUpdErr.message);
      }
    }

    await recordAuditLog(session, {
      action: 'CASH_DISPATCHED',
      resource: transfer.transfer_ref,
      branchId: transfer.source_branch_id,
      details: {
        transferRef: transfer.transfer_ref,
        dispatchRef,
        sourceBranch: transfer.source_branch_id,
        destinationBranch: transfer.destination_branch_id,
        amount,
        carrierName: carrierPersonName,
        carrierNic: carrierPersonNic,
        sealNo: securityBagSealNo
      }
    });

    return NextResponse.json({
      success: true,
      dispatch: dispatchRecord,
      transferRef: transfer.transfer_ref,
      status: 'IN_TRANSIT'
    }, { status: 201 });

  } catch (err: any) {
    console.error('Cash dispatch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
