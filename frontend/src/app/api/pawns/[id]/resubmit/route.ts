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
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const userRole = (session.role || '').toUpperCase();
    if (userRole === 'AUDITOR') {
      return NextResponse.json({
        error: 'Forbidden. Auditors must wait for Branch Staff or Manager to resolve and resubmit REQUIRES_RECHECK items.'
      }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const resolutionNote = String(body?.note || body?.notes || body?.resolutionNote || '').trim();

    if (!resolutionNote) {
      return NextResponse.json({
        error: 'A resolution note explaining the correction is required before resubmitting for audit.'
      }, { status: 400 });
    }

    let pawnQuery = adminSupabase.from('pawns').select('*');
    if (isUUID(id)) {
      pawnQuery = pawnQuery.eq('id', id);
    } else {
      const { data: matches, error: mErr } = await adminSupabase.from('pawns').select('*').eq('bill_no', id).limit(2);
      if (mErr) throw mErr;
      if (matches && matches.length > 1) {
        return NextResponse.json({ error: 'Ambiguous bill number across branches. Please use exact pawn UUID.' }, { status: 400 });
      }
      const single = matches?.[0] || null;
      if (!single) {
        return NextResponse.json({ error: 'Pawn transaction not found.' }, { status: 404 });
      }
      pawnQuery = adminSupabase.from('pawns').select('*').eq('id', single.id);
    }

    const { data: pawn, error: fetchErr } = await pawnQuery.maybeSingle();
    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn transaction not found.' }, { status: 404 });
    }

    const pawnBranch = normalizeBranchId(pawn.branch_id || '');
    if (userRole === 'TELLER') {
      const tellerBranch = normalizeBranchId(session.branchId || '');
      if (tellerBranch && tellerBranch !== 'HQ' && pawnBranch !== tellerBranch) {
        return NextResponse.json({
          error: 'Forbidden. Tellers can only resubmit recheck transactions for their own branch.'
        }, { status: 403 });
      }
    }

    if (pawn.status !== 'REQUIRES_RECHECK') {
      return NextResponse.json({
        error: `Only transactions in REQUIRES_RECHECK status can be resubmitted (current status: ${pawn.status}).`
      }, { status: 409 });
    }

    const actorId = session.user?.id || 'STAFF';
    const actorEmail = session.user?.email || session.profile?.email || 'staff@mifos.lk';
    const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();
    const nowIso = new Date().toISOString();

    // 1. Mark active unresolved AUDIT_ISSUE_RAISED rows for this pawn as resolved
    let issueQuery = adminSupabase.from('audit_logs').select('*').eq('action', 'AUDIT_ISSUE_RAISED');
    if (cleanBill) {
      issueQuery = issueQuery.or(`resource.eq."${cleanBill}",resource.eq."${pawn.id}"`);
    } else {
      issueQuery = issueQuery.eq('resource', pawn.id);
    }
    const { data: issues, error: issueFetchErr } = await issueQuery;
    if (issueFetchErr) throw issueFetchErr;

    const unresolvedForPawn = (issues || []).filter((l: any) => {
      const logPawnId = l.details?.pawn_id;
      if (logPawnId && logPawnId !== pawn.id) return false;
      const logBranch = normalizeBranchId(l.branch_id || l.details?.branch_id || '');
      if (!logPawnId && pawnBranch && logBranch && logBranch !== pawnBranch) return false;
      return l.details?.status === 'REQUIRES_RECHECK' || l.details?.resolved === false;
    });

    for (const issueRow of unresolvedForPawn) {
      const updatedDetails = {
        ...(issueRow.details || {}),
        resolved: true,
        status: 'RESOLVED',
        resolved_by: actorEmail,
        resolved_by_id: actorId,
        resolved_at: nowIso,
        resolution_note: resolutionNote
      };
      const { error: updIssueErr } = await adminSupabase
        .from('audit_logs')
        .update({ details: updatedDetails })
        .eq('id', issueRow.id);
      if (updIssueErr) throw updIssueErr;
    }

    // 2. Log RECHECK_RESUBMITTED event in immutable audit trail
    const { error: logErr } = await adminSupabase.from('audit_logs').insert([{
      user_id: actorId,
      user_email: actorEmail,
      role: userRole || 'STAFF',
      branch_id: pawn.branch_id,
      action: 'RECHECK_RESUBMITTED',
      resource: cleanBill,
      details: {
        pawn_id: pawn.id,
        bill_no: cleanBill,
        branch_id: pawn.branch_id,
        resolved_issue_count: unresolvedForPawn.length,
        resolution_note: resolutionNote,
        previous_status: pawn.status,
        status: 'PENDING_APPROVAL',
        resubmitted_at: nowIso
      },
      created_at: nowIso
    }]);
    if (logErr) throw logErr;

    // 3. Move pawn back to PENDING_APPROVAL so Auditor can re-verify before Manager approval
    const { data: updatedPawnRows, error: pawnUpdErr } = await adminSupabase
      .from('pawns')
      .update({ status: 'PENDING_APPROVAL' })
      .eq('id', pawn.id)
      .eq('status', 'REQUIRES_RECHECK')
      .select('id');

    if (pawnUpdErr) throw pawnUpdErr;
    if (!updatedPawnRows || updatedPawnRows.length === 0) {
      return NextResponse.json({ error: 'Transaction status changed concurrently.' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      message: `Bill #${cleanBill} resolved and resubmitted for Auditor re-verification.`,
      status: 'PENDING_APPROVAL',
      resolvedIssuesCount: unresolvedForPawn.length
    });
  } catch (error: any) {
    console.error('Resubmit Recheck POST Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to resubmit transaction for re-audit' }, { status: 500 });
  }
}

