import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: banks, error } = await adminSupabase
      .from('bank_accounts')
      .select('*')
      .order('bank_name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const isAdmin = session.role === 'ADMIN';

    const formatted = (banks || []).map((b: any) => ({
      id: b.id,
      bankName: b.bank_name,
      accountName: b.account_name,
      // Full account number only visible to Admin; masked for other staff
      accountNumber: isAdmin ? b.account_number : (b.account_number ? `${b.account_number.slice(0, 4)}****${b.account_number.slice(-3)}` : '****'),
      rawAccountNumber: isAdmin ? b.account_number : undefined,
      currency: b.currency || 'LKR',
      branchId: b.branch_id,
      glAccountName: b.gl_account_name,
      openingBalance: Number(b.opening_balance || 0),
      currentBalance: Number(b.current_balance || 0),
      lastReconciledAt: b.last_reconciled_at,
      lastReconciledBalance: b.last_reconciled_balance !== null ? Number(b.last_reconciled_balance) : null,
      isActive: b.is_active,
      createdAt: b.created_at
    }));

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin authorization required to register bank accounts.' }, { status: 403 });
    }

    const body = await request.json();
    const { bankName, accountName, accountNumber, branchId, glAccountName, openingBalance = 0, currency = 'LKR' } = body;

    if (!bankName || !accountName || !accountNumber) {
      return NextResponse.json({ error: 'Bank name, account name, and account number are required.' }, { status: 400 });
    }

    const parsedOpening = Number(openingBalance ?? 0);
    if (!Number.isFinite(parsedOpening) || parsedOpening < 0) {
      return NextResponse.json({ error: 'Opening balance must be a valid non-negative number.' }, { status: 400 });
    }
    const normalizedBranch = branchId && String(branchId).trim() !== '' ? normalizeBranchId(String(branchId)) : null;

    const { data, error } = await adminSupabase
      .from('bank_accounts')
      .insert([{
        bank_name: bankName.trim(),
        account_name: accountName.trim(),
        account_number: accountNumber.trim(),
        branch_id: normalizedBranch,
        gl_account_name: glAccountName?.trim() || 'Bank Current Account (Asset)',
        currency: currency.trim().toUpperCase(),
        opening_balance: parsedOpening,
        current_balance: parsedOpening,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A bank account with this account number is already registered.' }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await recordAuditLog(session, {
      action: 'BANK_ACCOUNT_REGISTERED',
      resource: `Bank Account #${data.id}`,
      branchId: branchId || 'HQ',
      details: {
        bankName,
        accountName,
        accountNumber: `${accountNumber.slice(0, 4)}****${accountNumber.slice(-3)}`,
        openingBalance: parsedOpening
      }
    });

    return NextResponse.json({ success: true, bankAccount: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session || (session.role !== 'ADMIN' && session.role !== 'MANAGER')) {
      return NextResponse.json({ error: 'Forbidden. Admin or Manager role required to update bank accounts.' }, { status: 403 });
    }

    const body = await request.json();
    const { id, currentBalance, notes, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Bank account id is required.' }, { status: 400 });
    }

    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (currentBalance !== undefined) {
      const parsedCurrent = Number(currentBalance);
      if (!Number.isFinite(parsedCurrent) || parsedCurrent < 0) {
        return NextResponse.json({ error: 'Reconciled balance must be a valid non-negative number.' }, { status: 400 });
      }
      updatePayload.current_balance = parsedCurrent;
      updatePayload.last_reconciled_at = new Date().toISOString();
      updatePayload.last_reconciled_balance = parsedCurrent;
    }
    if (isActive !== undefined) {
      updatePayload.is_active = Boolean(isActive);
    }

    const { data, error } = await adminSupabase
      .from('bank_accounts')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Bank account not found.' }, { status: 404 });
    }

    await recordAuditLog(session, {
      action: 'BANK_ACCOUNT_RECONCILED',
      resource: `Bank Account #${id}`,
      branchId: data.branch_id || 'HQ',
      details: {
        reconciledBalance: currentBalance,
        notes: notes || 'Manual statement reconciliation'
      }
    });

    return NextResponse.json({ success: true, bankAccount: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
