import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await params;

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    if (session.role !== 'AUDITOR' && session.role !== 'ADMIN') {
      return NextResponse.json({ 
        error: `Forbidden. Role '${session.role}' is not authorized to raise auditor issues.` 
      }, { status: 403 });
    }

    const body = await request.json();
    const { category, note, details } = body;

    if (!category || !note?.trim()) {
      return NextResponse.json({ 
        error: 'Both issue category and error/observation note are required.' 
      }, { status: 400 });
    }

    // 1. Fetch Pawn Details by UUID (or unambiguous bill_no)
    let pawn: any = null;
    if (isUUID(id)) {
      const { data, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).maybeSingle();
      if (fetchErr) throw fetchErr;
      pawn = data;
    } else {
      const { data: matches, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('bill_no', id).limit(2);
      if (fetchErr) throw fetchErr;
      if (matches && matches.length > 1) {
        return NextResponse.json({ error: 'Ambiguous bill number across branches. Please use exact pawn UUID.' }, { status: 400 });
      }
      pawn = matches?.[0] || null;
    }

    if (!pawn) {
      return NextResponse.json({ error: 'Pawn transaction not found.' }, { status: 404 });
    }

    // 2. Auditors and Admins can raise issues across all branches including Head Office

    const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();
    const auditorId = session.user?.id || (session as any).id || 'AUDITOR';
    const auditorEmail = session.user?.email || (session as any).email || 'auditor@mifos.lk';
    const branchId = pawn.branch_id || session.branchId || 'HQ';
    const timestamp = new Date().toISOString();

    const issueDetails = {
      pawn_id: pawn.id,
      bill_no: cleanBill,
      branch_id: branchId,
      auditor_id: auditorId,
      auditor_email: auditorEmail,
      category,
      note: note.trim(),
      previous_status: pawn.status,
      status: 'REQUIRES_RECHECK',
      resolved: false,
      reported_at: timestamp,
      extra_details: details || null
    };

    // 3. Save Issue in audit_logs (maintains complete immutable audit trail)
    const { data: auditLogEntry, error: logErr } = await adminSupabase
      .from('audit_logs')
      .insert([{
        user_id: auditorId,
        user_email: auditorEmail,
        role: 'AUDITOR',
        branch_id: branchId,
        action: 'AUDIT_ISSUE_RAISED',
        resource: cleanBill,
        details: issueDetails,
        created_at: timestamp
      }])
      .select()
      .single();

    if (logErr) {
      console.error('Error inserting audit issue log:', logErr);
      throw logErr;
    }

    // 4. Mark the transaction in pawns as requiring correction/recheck
    const { error: updateErr } = await adminSupabase
      .from('pawns')
      .update({
        status: 'REQUIRES_RECHECK'
      })
      .eq('id', pawn.id);

    if (updateErr) {
      console.error('Error updating pawn status to REQUIRES_RECHECK:', updateErr);
      throw updateErr;
    }

    return NextResponse.json({
      success: true,
      message: `Auditor issue successfully raised for Bill #${cleanBill}. Marked as requiring correction/recheck.`,
      issue: issueDetails,
      logId: auditLogEntry?.id
    });
  } catch (error: any) {
    console.error('Pawn Issue POST Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to record auditor issue' }, { status: 500 });
  }
}
