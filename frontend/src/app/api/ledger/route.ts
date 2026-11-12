import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { data: entries, error } = await adminSupabase
      .from('journal_entry')
      .select('*, journal_entry_line(*)')
      .order('date', { ascending: false });

    if (error) throw error;
    return NextResponse.json(entries || []);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot post general ledger entries.' }, { status: 403 });
    }

    const body = await request.json();
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    const dateStr = String(body?.date || '').trim();
    const descriptionStr = String(body?.description || '').trim();

    if (!dateStr || !descriptionStr) {
      return NextResponse.json({ error: 'Journal entry date and description are required.' }, { status: 400 });
    }
    if (entries.length === 0) {
      return NextResponse.json({ error: 'At least one journal entry line is required.' }, { status: 400 });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of entries) {
      const accountName = String(line?.account || '').trim();
      const debitVal = Number(line?.debit ?? 0);
      const creditVal = Number(line?.credit ?? 0);
      if (!accountName) {
        return NextResponse.json({ error: 'Every journal entry line must specify an account.' }, { status: 400 });
      }
      if (!Number.isFinite(debitVal) || !Number.isFinite(creditVal) || debitVal < 0 || creditVal < 0) {
        return NextResponse.json({ error: 'Debit and Credit amounts must be valid non-negative numbers.' }, { status: 400 });
      }
      if (debitVal === 0 && creditVal === 0) {
        return NextResponse.json({ error: 'Journal entry lines cannot have both zero debit and zero credit.' }, { status: 400 });
      }
      totalDebit += debitVal;
      totalCredit += creditVal;
    }

    if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json({ error: "Debits and Credits must be positive and balance identically." }, { status: 400 });
    }

    const entryId = `JE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // Insert Header
    const { error: headerError } = await adminSupabase.from('journal_entry').insert([{
      id: entryId,
      date: dateStr,
      description: descriptionStr,
      reference: body.reference || null,
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by: session.user.email || body.createdBy || 'System User'
    }]);

    if (headerError) throw headerError;

    // Insert Lines (with header rollback if lines insert fails)
    const lines = entries.map((line: any) => ({
      journal_entry_id: entryId,
      account_name: String(line.account).trim(),
      debit: Number(line.debit ?? 0),
      credit: Number(line.credit ?? 0)
    }));

    const { error: linesError } = await adminSupabase.from('journal_entry_line').insert(lines);
    if (linesError) {
      await adminSupabase.from('journal_entry').delete().eq('id', entryId);
      throw linesError;
    }
    
    return NextResponse.json({ success: true, id: entryId }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
