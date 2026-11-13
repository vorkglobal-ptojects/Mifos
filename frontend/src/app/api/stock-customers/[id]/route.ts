import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId } from '@/lib/branch-mapping';
import {
  CUSTOMER_DELETE_BLOCK_MESSAGE,
  syncStockCustomerToClients,
} from '@/lib/cross-sync';

export const dynamic = 'force-dynamic';

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('94') && clean.length === 11) {
    clean = '0' + clean.slice(2);
  } else if (clean.length === 9 && !clean.startsWith('0')) {
    clean = '0' + clean;
  }
  return clean;
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: CUSTOMER_DELETE_BLOCK_MESSAGE }, { status: 403 });
  } catch (error: any) {
    console.error("API DELETE Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: any) {
  return handleUpdate(request, context);
}

export async function PATCH(request: Request, context: any) {
  return handleUpdate(request, context);
}

async function handleUpdate(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot modify customer records.' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { name, address, address_2, tp, nic, bill_numbers, branch_id } = body;

    const { data: existingCust, error: fetchErr } = await adminSupabase
      .from('stock_customers')
      .select('id, branch_id, nic, name, tp, address')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existingCust) {
      return NextResponse.json({ error: 'Customer profile not found' }, { status: 404 });
    }

    const userBranch = normalizeBranchId(session.branchId || 'HQ');
    const isGlobalRole = session.role === 'ADMIN' || userBranch === 'HQ';
    if (!isGlobalRole && existingCust.branch_id && normalizeBranchId(existingCust.branch_id) !== userBranch) {
      return NextResponse.json({ error: 'Forbidden. Cannot modify a customer profile belonging to another branch.' }, { status: 403 });
    }

    const cleanName = name?.trim();
    const cleanAddress = address?.trim();
    const cleanAddress2 = address_2 ? address_2.trim() : null;
    const fullAddress = cleanAddress2 ? `${cleanAddress}, ${cleanAddress2}` : cleanAddress;
    const formattedPhone = normalizePhone(tp);
    const cleanBills = (bill_numbers || '').trim();
    const headerBranch = request.headers.get('x-branch-id') || request.headers.get('X-Branch-Id');
    const effectiveBranch = !isGlobalRole
      ? userBranch
      : normalizeBranchId(branch_id || existingCust.branch_id || headerBranch || session?.branchId || 'HQ');

    // 1. Update stock_customers table (preserving strict branch ownership)
    const updatePayload: any = {};
    if (cleanName) updatePayload.name = cleanName;
    if (cleanAddress) updatePayload.address = cleanAddress;
    if (cleanAddress2 !== undefined) updatePayload.address_2 = cleanAddress2;
    if (formattedPhone) updatePayload.tp = formattedPhone;
    if (nic !== undefined) updatePayload.nic = nic ? String(nic).trim() : null;
    if (cleanBills !== undefined) updatePayload.bill_numbers = cleanBills;
    if (effectiveBranch && effectiveBranch !== 'HQ' && (branch_id || !existingCust.branch_id)) {
      updatePayload.branch_id = effectiveBranch;
    }

    const { data: updatedCustomer, error: updateErr } = await adminSupabase
      .from('stock_customers')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // 2. Reverse-sync to branch-scoped clients, pawns.unique_tag & caches
    const syncBranch =
      effectiveBranch !== 'HQ'
        ? effectiveBranch
        : existingCust.branch_id
        ? normalizeBranchId(existingCust.branch_id)
        : 'HQ';

    await syncStockCustomerToClients({
      branchId: syncBranch,
      oldNic: existingCust.nic,
      newNic: nic !== undefined ? String(nic || '').trim() : existingCust.nic,
      oldName: existingCust.name,
      oldPhone: existingCust.tp,
      name: cleanName || existingCust.name,
      tp: formattedPhone || existingCust.tp,
      address: fullAddress || existingCust.address,
    });

    return NextResponse.json({
      success: true,
      customer: updatedCustomer
    });
  } catch (err: any) {
    console.error('Stock customers PUT/PATCH error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update customer profile' }, { status: 500 });
  }
}
