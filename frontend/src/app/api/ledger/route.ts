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
    
    // Server-side double-entry validation
    const totalDebit = (body.entries || []).reduce((sum: number, line: any) => sum + (parseFloat(line.debit) || 0), 0);
    const totalCredit = (body.entries || []).reduce((sum: number, line: any) => sum + (parseFloat(line.credit) || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json({ error: "Debits and Credits must balance identically." }, { status: 400 });
    }

    const entryId = `JE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // Insert Header
    const { error: headerError } = await adminSupabase.from('journal_entry').insert([{
      id: entryId,
      date: body.date,
      description: body.description,
      reference: body.reference,
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by: session.user.email || body.createdBy || 'System User'
    }]);

    if (headerError) throw headerError;

    // Insert Lines
    const lines = (body.entries || []).map((line: any) => ({
      journal_entry_id: entryId,
      account_name: line.account,
      debit: parseFloat(line.debit) || 0,
      credit: parseFloat(line.credit) || 0
    }));

    const { error: linesError } = await adminSupabase.from('journal_entry_line').insert(lines);
    if (linesError) throw linesError;
    
    return NextResponse.json({ success: true, id: entryId }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
